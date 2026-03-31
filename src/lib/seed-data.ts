// =============================================================================
// MedShip Prometheus — Seed Data
// Deterministic demo data for the monitoring dashboard
// =============================================================================

import type {
  SyncEvent,
  Automation,
  SystemName,
  FieldMapping,
  ConnectionConfig,
} from '@/types'

// =============================================================================
// Seeded PRNG — deterministic random so data never changes between renders
// =============================================================================

function seededRandom(seed: number): () => number {
  let s = seed
  return () => {
    s = (s * 16807 + 0) % 2147483647
    return s / 2147483647
  }
}

function pick<T>(arr: T[], rand: () => number): T {
  return arr[Math.floor(rand() * arr.length)]
}

function pickN<T>(arr: T[], n: number, rand: () => number): T[] {
  const shuffled = [...arr].sort(() => rand() - 0.5)
  return shuffled.slice(0, n)
}

function randomInt(min: number, max: number, rand: () => number): number {
  return Math.floor(rand() * (max - min + 1)) + min
}

// =============================================================================
// 1. Products (50+)
// =============================================================================

export interface Product {
  id: string
  sku: string
  name: string
  category:
    | 'Capital Equipment'
    | 'Simulation'
    | 'Supplies'
    | 'Kits'
    | 'Diagnostics'
    | 'Consumables'
  price: number
  cost: number
  qtyOnHand: number
  qtyAllocated: number
  qtyAvailable: number
  reorderPoint: number
  lastSyncedAt: string
}

export const seedProducts: Product[] = [
  // --- Capital Equipment ($15k–$80k) ---
  { id: 'PROD-001', sku: 'CE-PYX-ES', name: 'BD Pyxis MedStation ES', category: 'Capital Equipment', price: 78000, cost: 52000, qtyOnHand: 4, qtyAllocated: 2, qtyAvailable: 2, reorderPoint: 2, lastSyncedAt: '2026-03-31T08:15:00Z' },
  { id: 'PROD-002', sku: 'CE-SIM3G', name: 'Laerdal SimMan 3G PLUS', category: 'Capital Equipment', price: 72000, cost: 48000, qtyOnHand: 3, qtyAllocated: 1, qtyAvailable: 2, reorderPoint: 2, lastSyncedAt: '2026-03-31T08:15:00Z' },
  { id: 'PROD-003', sku: 'CE-LUCINA', name: 'CAE Lucina Childbirth Simulator', category: 'Capital Equipment', price: 65000, cost: 43000, qtyOnHand: 2, qtyAllocated: 1, qtyAvailable: 1, reorderPoint: 1, lastSyncedAt: '2026-03-31T08:15:00Z' },
  { id: 'PROD-004', sku: 'CE-HILLROM', name: 'Hill-Rom Centrella Smart+ Bed', category: 'Capital Equipment', price: 32000, cost: 21000, qtyOnHand: 6, qtyAllocated: 3, qtyAvailable: 3, reorderPoint: 3, lastSyncedAt: '2026-03-31T08:15:00Z' },
  { id: 'PROD-005', sku: 'CE-STRYKER', name: 'Stryker InTouch ICU Bed', category: 'Capital Equipment', price: 45000, cost: 30000, qtyOnHand: 3, qtyAllocated: 2, qtyAvailable: 1, reorderPoint: 2, lastSyncedAt: '2026-03-31T08:15:00Z' },
  { id: 'PROD-006', sku: 'CE-DEFIB', name: 'ZOLL R Series Defibrillator Monitor', category: 'Capital Equipment', price: 22000, cost: 14500, qtyOnHand: 5, qtyAllocated: 1, qtyAvailable: 4, reorderPoint: 3, lastSyncedAt: '2026-03-31T08:15:00Z' },
  { id: 'PROD-007', sku: 'CE-VENT', name: 'Dräger Evita V500 Ventilator', category: 'Capital Equipment', price: 38000, cost: 25000, qtyOnHand: 0, qtyAllocated: 0, qtyAvailable: 0, reorderPoint: 2, lastSyncedAt: '2026-03-31T08:15:00Z' },
  { id: 'PROD-008', sku: 'CE-PUMP', name: 'BD Alaris Infusion Pump System', category: 'Capital Equipment', price: 15500, cost: 10200, qtyOnHand: 12, qtyAllocated: 4, qtyAvailable: 8, reorderPoint: 5, lastSyncedAt: '2026-03-31T08:15:00Z' },

  // --- Simulation ($5k–$50k) ---
  { id: 'PROD-009', sku: 'SIM-ANNE', name: 'Laerdal Nursing Anne Simulator', category: 'Simulation', price: 28000, cost: 18500, qtyOnHand: 5, qtyAllocated: 2, qtyAvailable: 3, reorderPoint: 3, lastSyncedAt: '2026-03-31T08:15:00Z' },
  { id: 'PROD-010', sku: 'SIM-NEWB', name: 'Laerdal SimNewB Newborn Simulator', category: 'Simulation', price: 32000, cost: 21000, qtyOnHand: 3, qtyAllocated: 1, qtyAvailable: 2, reorderPoint: 2, lastSyncedAt: '2026-03-31T08:15:00Z' },
  { id: 'PROD-011', sku: 'SIM-RAQCPR', name: 'Laerdal Resusci Anne QCPR', category: 'Simulation', price: 8500, cost: 5600, qtyOnHand: 10, qtyAllocated: 3, qtyAvailable: 7, reorderPoint: 5, lastSyncedAt: '2026-03-31T08:15:00Z' },
  { id: 'PROD-012', sku: 'SIM-VITAL', name: 'Laerdal VitalSim Vitals Simulator', category: 'Simulation', price: 5200, cost: 3400, qtyOnHand: 8, qtyAllocated: 2, qtyAvailable: 6, reorderPoint: 4, lastSyncedAt: '2026-03-31T08:15:00Z' },
  { id: 'PROD-013', sku: 'SIM-MEGA', name: 'Gaumard Noelle Maternal Simulator', category: 'Simulation', price: 48000, cost: 32000, qtyOnHand: 2, qtyAllocated: 1, qtyAvailable: 1, reorderPoint: 1, lastSyncedAt: '2026-03-31T08:15:00Z' },
  { id: 'PROD-014', sku: 'SIM-PEDI', name: 'Gaumard Pediatric HAL S3005', category: 'Simulation', price: 42000, cost: 28000, qtyOnHand: 1, qtyAllocated: 1, qtyAvailable: 0, reorderPoint: 1, lastSyncedAt: '2026-03-31T08:15:00Z' },
  { id: 'PROD-015', sku: 'SIM-SUSIE', name: 'Gaumard Susie Simon Patient Simulator', category: 'Simulation', price: 18000, cost: 12000, qtyOnHand: 4, qtyAllocated: 1, qtyAvailable: 3, reorderPoint: 2, lastSyncedAt: '2026-03-31T08:15:00Z' },
  { id: 'PROD-016', sku: 'SIM-JUNO', name: 'CAE Juno Clinical Skills Manikin', category: 'Simulation', price: 12500, cost: 8200, qtyOnHand: 6, qtyAllocated: 2, qtyAvailable: 4, reorderPoint: 3, lastSyncedAt: '2026-03-31T08:15:00Z' },
  { id: 'PROD-017', sku: 'SIM-ARIA', name: 'CAE Aria Patient Simulator', category: 'Simulation', price: 35000, cost: 23000, qtyOnHand: 2, qtyAllocated: 0, qtyAvailable: 2, reorderPoint: 1, lastSyncedAt: '2026-03-31T08:15:00Z' },

  // --- Supplies ($50–$500) ---
  { id: 'PROD-018', sku: 'SUP-IVARM', name: 'Multi-Venous IV Training Arm', category: 'Supplies', price: 385, cost: 210, qtyOnHand: 30, qtyAllocated: 8, qtyAvailable: 22, reorderPoint: 15, lastSyncedAt: '2026-03-31T08:15:00Z' },
  { id: 'PROD-019', sku: 'SUP-INJPAD', name: 'IM Injection Training Pad', category: 'Supplies', price: 95, cost: 42, qtyOnHand: 60, qtyAllocated: 12, qtyAvailable: 48, reorderPoint: 25, lastSyncedAt: '2026-03-31T08:15:00Z' },
  { id: 'PROD-020', sku: 'SUP-CATH', name: 'Catheterization Training Simulator', category: 'Supplies', price: 450, cost: 240, qtyOnHand: 18, qtyAllocated: 5, qtyAvailable: 13, reorderPoint: 10, lastSyncedAt: '2026-03-31T08:15:00Z' },
  { id: 'PROD-021', sku: 'SUP-SUTURE', name: 'Suture Practice Pad with Wounds', category: 'Supplies', price: 75, cost: 32, qtyOnHand: 80, qtyAllocated: 15, qtyAvailable: 65, reorderPoint: 30, lastSyncedAt: '2026-03-31T08:15:00Z' },
  { id: 'PROD-022', sku: 'SUP-TRACH', name: 'Tracheostomy Care Trainer', category: 'Supplies', price: 320, cost: 175, qtyOnHand: 12, qtyAllocated: 3, qtyAvailable: 9, reorderPoint: 5, lastSyncedAt: '2026-03-31T08:15:00Z' },
  { id: 'PROD-023', sku: 'SUP-NGT', name: 'NG Tube Insertion Trainer', category: 'Supplies', price: 280, cost: 150, qtyOnHand: 10, qtyAllocated: 2, qtyAvailable: 8, reorderPoint: 5, lastSyncedAt: '2026-03-31T08:15:00Z' },
  { id: 'PROD-024', sku: 'SUP-AIRWY', name: 'Airway Management Trainer', category: 'Supplies', price: 425, cost: 230, qtyOnHand: 14, qtyAllocated: 4, qtyAvailable: 10, reorderPoint: 6, lastSyncedAt: '2026-03-31T08:15:00Z' },
  { id: 'PROD-025', sku: 'SUP-PHLEBV', name: 'Venipuncture Training Arm', category: 'Supplies', price: 350, cost: 190, qtyOnHand: 20, qtyAllocated: 6, qtyAvailable: 14, reorderPoint: 10, lastSyncedAt: '2026-03-31T08:15:00Z' },
  { id: 'PROD-026', sku: 'SUP-WOUND', name: 'Wound Care Training Kit', category: 'Supplies', price: 195, cost: 105, qtyOnHand: 25, qtyAllocated: 7, qtyAvailable: 18, reorderPoint: 12, lastSyncedAt: '2026-03-31T08:15:00Z' },
  { id: 'PROD-027', sku: 'SUP-OSTOMY', name: 'Ostomy Care Simulator', category: 'Supplies', price: 260, cost: 140, qtyOnHand: 8, qtyAllocated: 2, qtyAvailable: 6, reorderPoint: 4, lastSyncedAt: '2026-03-31T08:15:00Z' },

  // --- Kits ($200–$2000) ---
  { id: 'PROD-028', sku: 'KIT-FUND', name: 'Fundamentals of Nursing Lab Kit', category: 'Kits', price: 850, cost: 460, qtyOnHand: 40, qtyAllocated: 12, qtyAvailable: 28, reorderPoint: 20, lastSyncedAt: '2026-03-31T08:15:00Z' },
  { id: 'PROD-029', sku: 'KIT-ASSESS', name: 'Health Assessment Kit', category: 'Kits', price: 620, cost: 340, qtyOnHand: 35, qtyAllocated: 10, qtyAvailable: 25, reorderPoint: 15, lastSyncedAt: '2026-03-31T08:15:00Z' },
  { id: 'PROD-030', sku: 'KIT-CLIN', name: 'Clinical Rotation Kit', category: 'Kits', price: 480, cost: 260, qtyOnHand: 50, qtyAllocated: 18, qtyAvailable: 32, reorderPoint: 25, lastSyncedAt: '2026-03-31T08:15:00Z' },
  { id: 'PROD-031', sku: 'KIT-PHAR', name: 'Pharmacology Skills Kit', category: 'Kits', price: 720, cost: 390, qtyOnHand: 22, qtyAllocated: 5, qtyAvailable: 17, reorderPoint: 10, lastSyncedAt: '2026-03-31T08:15:00Z' },
  { id: 'PROD-032', sku: 'KIT-ADV', name: 'Advanced Nursing Skills Kit', category: 'Kits', price: 1450, cost: 780, qtyOnHand: 15, qtyAllocated: 4, qtyAvailable: 11, reorderPoint: 8, lastSyncedAt: '2026-03-31T08:15:00Z' },
  { id: 'PROD-033', sku: 'KIT-PEDI', name: 'Pediatric Nursing Kit', category: 'Kits', price: 980, cost: 530, qtyOnHand: 18, qtyAllocated: 6, qtyAvailable: 12, reorderPoint: 8, lastSyncedAt: '2026-03-31T08:15:00Z' },
  { id: 'PROD-034', sku: 'KIT-OB', name: 'OB/Maternity Nursing Kit', category: 'Kits', price: 1100, cost: 595, qtyOnHand: 12, qtyAllocated: 3, qtyAvailable: 9, reorderPoint: 6, lastSyncedAt: '2026-03-31T08:15:00Z' },
  { id: 'PROD-035', sku: 'KIT-MENT', name: 'Mental Health Nursing Kit', category: 'Kits', price: 380, cost: 205, qtyOnHand: 20, qtyAllocated: 4, qtyAvailable: 16, reorderPoint: 10, lastSyncedAt: '2026-03-31T08:15:00Z' },
  { id: 'PROD-036', sku: 'KIT-GERI', name: 'Geriatric Simulation Kit', category: 'Kits', price: 1800, cost: 970, qtyOnHand: 5, qtyAllocated: 2, qtyAvailable: 3, reorderPoint: 3, lastSyncedAt: '2026-03-31T08:15:00Z' },

  // --- Diagnostics ($20–$300) ---
  { id: 'PROD-037', sku: 'DX-STETH', name: '3M Littmann Classic III Stethoscope', category: 'Diagnostics', price: 110, cost: 62, qtyOnHand: 100, qtyAllocated: 25, qtyAvailable: 75, reorderPoint: 40, lastSyncedAt: '2026-03-31T08:15:00Z' },
  { id: 'PROD-038', sku: 'DX-STETH-C', name: '3M Littmann Cardiology IV', category: 'Diagnostics', price: 230, cost: 130, qtyOnHand: 40, qtyAllocated: 8, qtyAvailable: 32, reorderPoint: 15, lastSyncedAt: '2026-03-31T08:15:00Z' },
  { id: 'PROD-039', sku: 'DX-BPCUFF', name: 'ADC Diagnostix 720 BP Cuff', category: 'Diagnostics', price: 48, cost: 25, qtyOnHand: 120, qtyAllocated: 30, qtyAvailable: 90, reorderPoint: 50, lastSyncedAt: '2026-03-31T08:15:00Z' },
  { id: 'PROD-040', sku: 'DX-OTO', name: 'Welch Allyn Diagnostic Otoscope', category: 'Diagnostics', price: 285, cost: 158, qtyOnHand: 20, qtyAllocated: 5, qtyAvailable: 15, reorderPoint: 8, lastSyncedAt: '2026-03-31T08:15:00Z' },
  { id: 'PROD-041', sku: 'DX-PULSEOX', name: 'Masimo MightySat Pulse Oximeter', category: 'Diagnostics', price: 195, cost: 108, qtyOnHand: 35, qtyAllocated: 10, qtyAvailable: 25, reorderPoint: 15, lastSyncedAt: '2026-03-31T08:15:00Z' },
  { id: 'PROD-042', sku: 'DX-THERM', name: 'Welch Allyn SureTemp Plus Thermometer', category: 'Diagnostics', price: 165, cost: 90, qtyOnHand: 45, qtyAllocated: 8, qtyAvailable: 37, reorderPoint: 20, lastSyncedAt: '2026-03-31T08:15:00Z' },
  { id: 'PROD-043', sku: 'DX-GLUC', name: 'OneTouch Verio Reflect Glucose Meter', category: 'Diagnostics', price: 42, cost: 22, qtyOnHand: 60, qtyAllocated: 10, qtyAvailable: 50, reorderPoint: 25, lastSyncedAt: '2026-03-31T08:15:00Z' },
  { id: 'PROD-044', sku: 'DX-OPTH', name: 'Welch Allyn PanOptic Ophthalmoscope', category: 'Diagnostics', price: 295, cost: 165, qtyOnHand: 15, qtyAllocated: 4, qtyAvailable: 11, reorderPoint: 6, lastSyncedAt: '2026-03-31T08:15:00Z' },

  // --- Consumables ($10–$100) ---
  { id: 'PROD-045', sku: 'CON-SKIN', name: 'Replacement IV Arm Skin', category: 'Consumables', price: 38, cost: 15, qtyOnHand: 150, qtyAllocated: 30, qtyAvailable: 120, reorderPoint: 60, lastSyncedAt: '2026-03-31T08:15:00Z' },
  { id: 'PROD-046', sku: 'CON-BLOOD', name: 'Simulated Blood Concentrate (1L)', category: 'Consumables', price: 28, cost: 10, qtyOnHand: 200, qtyAllocated: 40, qtyAvailable: 160, reorderPoint: 80, lastSyncedAt: '2026-03-31T08:15:00Z' },
  { id: 'PROD-047', sku: 'CON-IVTUBE', name: 'IV Tubing Training Set (10-pack)', category: 'Consumables', price: 45, cost: 18, qtyOnHand: 90, qtyAllocated: 20, qtyAvailable: 70, reorderPoint: 40, lastSyncedAt: '2026-03-31T08:15:00Z' },
  { id: 'PROD-048', sku: 'CON-LUBRI', name: 'Lubricant Gel for Simulators (12-pack)', category: 'Consumables', price: 32, cost: 12, qtyOnHand: 70, qtyAllocated: 10, qtyAvailable: 60, reorderPoint: 30, lastSyncedAt: '2026-03-31T08:15:00Z' },
  { id: 'PROD-049', sku: 'CON-CATHK', name: 'Catheter Training Refill Kit', category: 'Consumables', price: 55, cost: 22, qtyOnHand: 45, qtyAllocated: 8, qtyAvailable: 37, reorderPoint: 20, lastSyncedAt: '2026-03-31T08:15:00Z' },
  { id: 'PROD-050', sku: 'CON-RESP', name: 'Disposable Lung Bags (50-pack)', category: 'Consumables', price: 65, cost: 28, qtyOnHand: 55, qtyAllocated: 12, qtyAvailable: 43, reorderPoint: 25, lastSyncedAt: '2026-03-31T08:15:00Z' },
  { id: 'PROD-051', sku: 'CON-WNDPK', name: 'Wound Moulage Wax Refill', category: 'Consumables', price: 22, cost: 8, qtyOnHand: 0, qtyAllocated: 0, qtyAvailable: 0, reorderPoint: 40, lastSyncedAt: '2026-03-31T08:15:00Z' },
  { id: 'PROD-052', sku: 'CON-SUTSUP', name: 'Suture Kit Refill (25-pack)', category: 'Consumables', price: 48, cost: 19, qtyOnHand: 35, qtyAllocated: 5, qtyAvailable: 30, reorderPoint: 15, lastSyncedAt: '2026-03-31T08:15:00Z' },
  { id: 'PROD-053', sku: 'CON-ELEC', name: 'ECG Electrode Pads (100-pack)', category: 'Consumables', price: 18, cost: 6, qtyOnHand: 180, qtyAllocated: 30, qtyAvailable: 150, reorderPoint: 70, lastSyncedAt: '2026-03-31T08:15:00Z' },
  { id: 'PROD-054', sku: 'CON-NGREF', name: 'NG Tube Replacement Set (5-pack)', category: 'Consumables', price: 42, cost: 16, qtyOnHand: 25, qtyAllocated: 5, qtyAvailable: 20, reorderPoint: 12, lastSyncedAt: '2026-03-31T08:15:00Z' },
]

// Products below reorder point (for dashboard alerts)
// qtyOnHand=0: PROD-007, PROD-051
// Below reorder point: PROD-005 (3 on hand, 2 reorder, but 1 avail), PROD-014 (1 on hand, 1 reorder, 0 avail),
//   PROD-036 (5 on hand, 3 reorder — actually fine), let's check...
// Extra below-reorder: handled naturally by the data above

// =============================================================================
// 2. Customers (30+)
// =============================================================================

export interface Customer {
  id: string
  name: string
  type: 'University' | 'Community College' | 'Hospital Training' | 'For-Profit'
  city: string
  state: string
  latitude: number
  longitude: number
  region: 'Northeast' | 'Southeast' | 'Midwest' | 'Southwest' | 'West'
  totalRevenue: number
  totalOrders: number
  lastOrderDate: string
  assignedRep: string
  customerStatus: 'active' | 'inactive' | 'prospect'
}

export const seedCustomers: Customer[] = [
  // --- Universities ---
  { id: 'CUST-001', name: 'Rush University College of Nursing', type: 'University', city: 'Chicago', state: 'IL', latitude: 41.8745, longitude: -87.6692, region: 'Midwest', totalRevenue: 284600, totalOrders: 18, lastOrderDate: '2026-03-28', assignedRep: 'Sarah Mitchell', customerStatus: 'active' },
  { id: 'CUST-002', name: 'University of Illinois Chicago College of Nursing', type: 'University', city: 'Chicago', state: 'IL', latitude: 41.8694, longitude: -87.6498, region: 'Midwest', totalRevenue: 198400, totalOrders: 14, lastOrderDate: '2026-03-22', assignedRep: 'Sarah Mitchell', customerStatus: 'active' },
  { id: 'CUST-003', name: 'Loyola University Chicago Marcella Niehoff School of Nursing', type: 'University', city: 'Maywood', state: 'IL', latitude: 41.8621, longitude: -87.8364, region: 'Midwest', totalRevenue: 156200, totalOrders: 11, lastOrderDate: '2026-03-15', assignedRep: 'Sarah Mitchell', customerStatus: 'active' },
  { id: 'CUST-004', name: 'NYU Rory Meyers College of Nursing', type: 'University', city: 'New York', state: 'NY', latitude: 40.7391, longitude: -73.9826, region: 'Northeast', totalRevenue: 312800, totalOrders: 16, lastOrderDate: '2026-03-25', assignedRep: 'James Thornton', customerStatus: 'active' },
  { id: 'CUST-005', name: 'Johns Hopkins School of Nursing', type: 'University', city: 'Baltimore', state: 'MD', latitude: 39.2979, longitude: -76.5927, region: 'Northeast', totalRevenue: 268500, totalOrders: 15, lastOrderDate: '2026-03-20', assignedRep: 'James Thornton', customerStatus: 'active' },
  { id: 'CUST-006', name: 'University of Pennsylvania School of Nursing', type: 'University', city: 'Philadelphia', state: 'PA', latitude: 39.9503, longitude: -75.1937, region: 'Northeast', totalRevenue: 224100, totalOrders: 13, lastOrderDate: '2026-03-18', assignedRep: 'James Thornton', customerStatus: 'active' },
  { id: 'CUST-007', name: 'Emory University Nell Hodgson Woodruff School of Nursing', type: 'University', city: 'Atlanta', state: 'GA', latitude: 33.7925, longitude: -84.3232, region: 'Southeast', totalRevenue: 186400, totalOrders: 12, lastOrderDate: '2026-03-26', assignedRep: 'Maria Gonzalez', customerStatus: 'active' },
  { id: 'CUST-008', name: 'Duke University School of Nursing', type: 'University', city: 'Durham', state: 'NC', latitude: 36.0014, longitude: -78.9382, region: 'Southeast', totalRevenue: 172300, totalOrders: 10, lastOrderDate: '2026-03-12', assignedRep: 'Maria Gonzalez', customerStatus: 'active' },
  { id: 'CUST-009', name: 'University of Michigan School of Nursing', type: 'University', city: 'Ann Arbor', state: 'MI', latitude: 42.2808, longitude: -83.7430, region: 'Midwest', totalRevenue: 205800, totalOrders: 13, lastOrderDate: '2026-03-29', assignedRep: 'Sarah Mitchell', customerStatus: 'active' },
  { id: 'CUST-010', name: 'UCLA School of Nursing', type: 'University', city: 'Los Angeles', state: 'CA', latitude: 34.0689, longitude: -118.4452, region: 'West', totalRevenue: 142600, totalOrders: 8, lastOrderDate: '2026-02-14', assignedRep: 'David Kim', customerStatus: 'active' },
  { id: 'CUST-011', name: 'Vanderbilt University School of Nursing', type: 'University', city: 'Nashville', state: 'TN', latitude: 36.1419, longitude: -86.8024, region: 'Southeast', totalRevenue: 148900, totalOrders: 9, lastOrderDate: '2026-03-08', assignedRep: 'Maria Gonzalez', customerStatus: 'active' },
  { id: 'CUST-012', name: 'University of Washington School of Nursing', type: 'University', city: 'Seattle', state: 'WA', latitude: 47.6533, longitude: -122.3076, region: 'West', totalRevenue: 118200, totalOrders: 7, lastOrderDate: '2026-01-22', assignedRep: 'David Kim', customerStatus: 'active' },
  { id: 'CUST-013', name: 'Case Western Reserve Frances Payne Bolton School of Nursing', type: 'University', city: 'Cleveland', state: 'OH', latitude: 41.5085, longitude: -81.6085, region: 'Midwest', totalRevenue: 134500, totalOrders: 9, lastOrderDate: '2026-03-10', assignedRep: 'Sarah Mitchell', customerStatus: 'active' },
  { id: 'CUST-014', name: 'University of Pittsburgh School of Nursing', type: 'University', city: 'Pittsburgh', state: 'PA', latitude: 40.4432, longitude: -79.9593, region: 'Northeast', totalRevenue: 98600, totalOrders: 6, lastOrderDate: '2026-02-28', assignedRep: 'James Thornton', customerStatus: 'active' },
  { id: 'CUST-015', name: 'Columbia University School of Nursing', type: 'University', city: 'New York', state: 'NY', latitude: 40.8422, longitude: -73.9418, region: 'Northeast', totalRevenue: 245200, totalOrders: 14, lastOrderDate: '2026-03-27', assignedRep: 'James Thornton', customerStatus: 'active' },
  // --- Community Colleges ---
  { id: 'CUST-016', name: 'College of DuPage Nursing Program', type: 'Community College', city: 'Glen Ellyn', state: 'IL', latitude: 41.8578, longitude: -88.0686, region: 'Midwest', totalRevenue: 42800, totalOrders: 8, lastOrderDate: '2026-03-05', assignedRep: 'Sarah Mitchell', customerStatus: 'active' },
  { id: 'CUST-017', name: 'Harper College Nursing Program', type: 'Community College', city: 'Palatine', state: 'IL', latitude: 42.1028, longitude: -88.0562, region: 'Midwest', totalRevenue: 36200, totalOrders: 7, lastOrderDate: '2026-02-18', assignedRep: 'Sarah Mitchell', customerStatus: 'active' },
  { id: 'CUST-018', name: 'Moraine Valley Community College', type: 'Community College', city: 'Palos Hills', state: 'IL', latitude: 41.7089, longitude: -87.8189, region: 'Midwest', totalRevenue: 28400, totalOrders: 5, lastOrderDate: '2026-01-15', assignedRep: 'Sarah Mitchell', customerStatus: 'active' },
  { id: 'CUST-019', name: 'Oakton College Nursing Program', type: 'Community College', city: 'Des Plaines', state: 'IL', latitude: 42.0382, longitude: -87.8771, region: 'Midwest', totalRevenue: 18600, totalOrders: 3, lastOrderDate: '2025-09-20', assignedRep: 'Sarah Mitchell', customerStatus: 'inactive' },
  { id: 'CUST-020', name: 'College of Lake County Nursing', type: 'Community College', city: 'Grayslake', state: 'IL', latitude: 42.3417, longitude: -88.0415, region: 'Midwest', totalRevenue: 22100, totalOrders: 4, lastOrderDate: '2025-08-12', assignedRep: 'Sarah Mitchell', customerStatus: 'inactive' },
  { id: 'CUST-021', name: 'Triton College Nursing Program', type: 'Community College', city: 'River Grove', state: 'IL', latitude: 41.9203, longitude: -87.8384, region: 'Midwest', totalRevenue: 14800, totalOrders: 3, lastOrderDate: '2025-07-30', assignedRep: 'Sarah Mitchell', customerStatus: 'inactive' },
  { id: 'CUST-022', name: 'Miami Dade College Nursing', type: 'Community College', city: 'Miami', state: 'FL', latitude: 25.7589, longitude: -80.3737, region: 'Southeast', totalRevenue: 52400, totalOrders: 6, lastOrderDate: '2026-03-14', assignedRep: 'Maria Gonzalez', customerStatus: 'active' },
  { id: 'CUST-023', name: 'Houston Community College Nursing', type: 'Community College', city: 'Houston', state: 'TX', latitude: 29.7183, longitude: -95.3444, region: 'Southwest', totalRevenue: 38600, totalOrders: 5, lastOrderDate: '2026-02-20', assignedRep: 'Lisa Chen', customerStatus: 'active' },
  // --- Hospital Training Programs ---
  { id: 'CUST-024', name: 'Northwestern Memorial Hospital Education', type: 'Hospital Training', city: 'Chicago', state: 'IL', latitude: 41.8962, longitude: -87.6214, region: 'Midwest', totalRevenue: 318200, totalOrders: 20, lastOrderDate: '2026-03-30', assignedRep: 'Sarah Mitchell', customerStatus: 'active' },
  { id: 'CUST-025', name: 'Advocate Aurora Health Training Center', type: 'Hospital Training', city: 'Downers Grove', state: 'IL', latitude: 41.7945, longitude: -88.0106, region: 'Midwest', totalRevenue: 142800, totalOrders: 10, lastOrderDate: '2026-03-18', assignedRep: 'Sarah Mitchell', customerStatus: 'active' },
  { id: 'CUST-026', name: 'Mayo Clinic Simulation Center', type: 'Hospital Training', city: 'Rochester', state: 'MN', latitude: 44.0225, longitude: -92.4668, region: 'Midwest', totalRevenue: 256400, totalOrders: 12, lastOrderDate: '2026-03-22', assignedRep: 'Sarah Mitchell', customerStatus: 'active' },
  { id: 'CUST-027', name: 'Cleveland Clinic Education Institute', type: 'Hospital Training', city: 'Cleveland', state: 'OH', latitude: 41.5015, longitude: -81.6219, region: 'Midwest', totalRevenue: 168900, totalOrders: 11, lastOrderDate: '2026-02-25', assignedRep: 'Sarah Mitchell', customerStatus: 'active' },
  { id: 'CUST-028', name: 'Massachusetts General Hospital Sim Center', type: 'Hospital Training', city: 'Boston', state: 'MA', latitude: 42.3626, longitude: -71.0688, region: 'Northeast', totalRevenue: 198700, totalOrders: 12, lastOrderDate: '2026-03-19', assignedRep: 'James Thornton', customerStatus: 'active' },
  // --- For-Profit ---
  { id: 'CUST-029', name: 'Chamberlain University College of Nursing', type: 'For-Profit', city: 'Addison', state: 'IL', latitude: 41.9328, longitude: -87.9892, region: 'Midwest', totalRevenue: 86400, totalOrders: 8, lastOrderDate: '2026-03-11', assignedRep: 'Lisa Chen', customerStatus: 'active' },
  { id: 'CUST-030', name: 'Herzing University Nursing Program', type: 'For-Profit', city: 'Milwaukee', state: 'WI', latitude: 43.0451, longitude: -87.9065, region: 'Midwest', totalRevenue: 48200, totalOrders: 5, lastOrderDate: '2026-02-08', assignedRep: 'Lisa Chen', customerStatus: 'active' },
  { id: 'CUST-031', name: 'Rasmussen University School of Nursing', type: 'For-Profit', city: 'Bloomington', state: 'MN', latitude: 44.8408, longitude: -93.2983, region: 'Midwest', totalRevenue: 0, totalOrders: 0, lastOrderDate: '', assignedRep: 'Lisa Chen', customerStatus: 'prospect' },
  { id: 'CUST-032', name: 'ECPI University Nursing', type: 'For-Profit', city: 'Virginia Beach', state: 'VA', latitude: 36.8529, longitude: -75.9780, region: 'Southeast', totalRevenue: 0, totalOrders: 0, lastOrderDate: '', assignedRep: 'Maria Gonzalez', customerStatus: 'prospect' },
]

// =============================================================================
// Region Summaries
// =============================================================================

export interface SeedRegionSummary {
  region: string
  customerCount: number
  activeCustomers: number
  totalRevenue: number
  avgOrderValue: number
  topRep: string
  growth: number
}

export const seedRegionSummaries: SeedRegionSummary[] = [
  { region: 'Midwest', customerCount: 18, activeCustomers: 15, totalRevenue: 1863200, avgOrderValue: 12450, topRep: 'Sarah Mitchell', growth: 18.4 },
  { region: 'Northeast', customerCount: 7, activeCustomers: 7, totalRevenue: 1347900, avgOrderValue: 14820, topRep: 'James Thornton', growth: 12.1 },
  { region: 'Southeast', customerCount: 5, activeCustomers: 4, totalRevenue: 560000, avgOrderValue: 10180, topRep: 'Maria Gonzalez', growth: 8.6 },
  { region: 'West', customerCount: 2, activeCustomers: 2, totalRevenue: 260800, avgOrderValue: 11200, topRep: 'David Kim', growth: -3.2 },
  { region: 'Southwest', customerCount: 1, activeCustomers: 1, totalRevenue: 38600, avgOrderValue: 7720, topRep: 'Lisa Chen', growth: 24.5 },
]

// =============================================================================
// 3. Sales Reps (5)
// =============================================================================

export interface SalesRep {
  id: string
  name: string
  email: string
  region: string
}

export const seedSalesReps: SalesRep[] = [
  { id: 'REP-001', name: 'Sarah Mitchell', email: 'sarah.mitchell@medshipllc.com', region: 'Midwest' },
  { id: 'REP-002', name: 'James Thornton', email: 'james.thornton@medshipllc.com', region: 'Northeast' },
  { id: 'REP-003', name: 'Maria Gonzalez', email: 'maria.gonzalez@medshipllc.com', region: 'Southeast' },
  { id: 'REP-004', name: 'David Kim', email: 'david.kim@medshipllc.com', region: 'West' },
  { id: 'REP-005', name: 'Lisa Chen', email: 'lisa.chen@medshipllc.com', region: 'South Central' },
]

// =============================================================================
// 4. Orders (200+ generated programmatically)
// =============================================================================

export interface OrderItem {
  productId: string
  productName: string
  sku: string
  quantity: number
  unitPrice: number
  total: number
}

export interface Order {
  id: string
  orderNumber: string
  customerId: string
  customerName: string
  salesRepId: string
  salesRepName: string
  date: string
  status: 'Closed Won' | 'Pending' | 'Shipped' | 'Delivered' | 'Cancelled'
  fulfillmentStatus: 'Synced' | 'Pending' | 'Failed' | 'N/A'
  trackingNumber?: string
  items: OrderItem[]
  subtotal: number
}

function generateOrders(): Order[] {
  const rand = seededRandom(42)
  const orders: Order[] = []

  // 12 months: Apr 2025 (index 0) through Mar 2026 (index 11)
  // Seasonal weights — higher in Aug-Sep (fall) and Jan-Feb (spring)
  const monthlyWeights = [
    12, // Apr 2025
    10, // May
    8,  // Jun
    7,  // Jul
    28, // Aug — fall semester peak
    25, // Sep
    14, // Oct
    10, // Nov
    6,  // Dec
    24, // Jan 2026 — spring semester peak
    22, // Feb
    16, // Mar
  ]
  const totalWeight = monthlyWeights.reduce((s, w) => s + w, 0)

  // Target ~220 orders
  const TARGET_ORDERS = 220

  // Compute order count per month
  const ordersPerMonth = monthlyWeights.map((w) =>
    Math.max(1, Math.round((w / totalWeight) * TARGET_ORDERS))
  )

  // Status distribution
  const statusOptions: Order['status'][] = [
    'Delivered', 'Delivered', 'Delivered', 'Delivered', 'Delivered', 'Delivered',
    'Shipped', 'Shipped', 'Shipped',
    'Closed Won', 'Closed Won',
    'Pending', 'Pending',
    'Cancelled',
  ]

  // Products grouped by approx price tier for realistic ordering
  const capitalProducts = seedProducts.filter((p) => p.category === 'Capital Equipment')
  const simProducts = seedProducts.filter((p) => p.category === 'Simulation')
  const supplyProducts = seedProducts.filter((p) => p.category === 'Supplies')
  const kitProducts = seedProducts.filter((p) => p.category === 'Kits')
  const dxProducts = seedProducts.filter((p) => p.category === 'Diagnostics')
  const conProducts = seedProducts.filter((p) => p.category === 'Consumables')

  // Weighted product pool: universities order big items, community colleges order kits/supplies
  const allProducts = seedProducts

  let orderIndex = 1

  for (let monthIdx = 0; monthIdx < 12; monthIdx++) {
    const year = monthIdx < 9 ? 2025 : 2026
    const month = monthIdx < 9 ? monthIdx + 4 : monthIdx - 8 // 4=Apr ... 12=Dec, 1=Jan, 2=Feb, 3=Mar

    const count = ordersPerMonth[monthIdx]

    for (let i = 0; i < count; i++) {
      const customer = pick(seedCustomers, rand)
      const rep = pick(seedSalesReps, rand)

      // Day of month
      const daysInMonth = new Date(year, month, 0).getDate()
      const day = randomInt(1, daysInMonth, rand)
      const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`

      // Line items: 1-4 per order (weighted toward fewer)
      const itemRoll = rand()
      const numItems = itemRoll < 0.3 ? 1 : itemRoll < 0.6 ? 2 : itemRoll < 0.85 ? 3 : 4
      const items: OrderItem[] = []

      // Determine product mix based on customer type
      // Capital equipment only appears in ~20% of university/hospital orders
      let productPool: Product[]
      if (customer.type === 'University' || customer.type === 'Hospital Training') {
        if (rand() < 0.2) {
          productPool = allProducts
        } else {
          productPool = [...simProducts, ...kitProducts, ...supplyProducts, ...dxProducts, ...conProducts]
        }
      } else if (customer.type === 'Community College') {
        productPool = [...kitProducts, ...supplyProducts, ...dxProducts, ...conProducts, ...simProducts]
      } else {
        productPool = [...kitProducts, ...supplyProducts, ...dxProducts, ...conProducts]
      }

      const selectedProducts = pickN(productPool, numItems, rand)

      for (const prod of selectedProducts) {
        let qty: number
        if (prod.category === 'Capital Equipment') {
          qty = 1
        } else if (prod.category === 'Simulation') {
          qty = randomInt(1, 2, rand)
        } else if (prod.category === 'Kits') {
          qty = randomInt(2, 12, rand)
        } else if (prod.category === 'Diagnostics') {
          qty = randomInt(3, 20, rand)
        } else if (prod.category === 'Consumables') {
          qty = randomInt(3, 15, rand)
        } else {
          qty = randomInt(1, 6, rand)
        }

        items.push({
          productId: prod.id,
          productName: prod.name,
          sku: prod.sku,
          quantity: qty,
          unitPrice: prod.price,
          total: qty * prod.price,
        })
      }

      const subtotal = items.reduce((s, item) => s + item.total, 0)

      // Status — recent orders more likely to be Pending/Shipped
      let status: Order['status']
      if (monthIdx >= 10) {
        // Feb-Mar 2026: more pending/shipped
        const recentStatuses: Order['status'][] = [
          'Delivered', 'Delivered', 'Delivered',
          'Shipped', 'Shipped', 'Shipped',
          'Closed Won', 'Closed Won',
          'Pending', 'Pending', 'Pending',
          'Cancelled',
        ]
        status = pick(recentStatuses, rand)
      } else if (monthIdx === 11) {
        // Mar 2026: mostly pending/shipped
        const latestStatuses: Order['status'][] = [
          'Delivered', 'Shipped', 'Shipped',
          'Closed Won', 'Closed Won', 'Closed Won',
          'Pending', 'Pending', 'Pending', 'Pending',
        ]
        status = pick(latestStatuses, rand)
      } else {
        status = pick(statusOptions, rand)
      }

      // Fulfillment status
      let fulfillmentStatus: Order['fulfillmentStatus']
      if (status === 'Cancelled') {
        fulfillmentStatus = 'N/A'
      } else if (status === 'Delivered' || status === 'Shipped') {
        fulfillmentStatus = rand() > 0.05 ? 'Synced' : 'Failed'
      } else if (status === 'Closed Won') {
        fulfillmentStatus = rand() > 0.15 ? 'Synced' : 'Pending'
      } else {
        fulfillmentStatus = 'Pending'
      }

      // Tracking number for shipped/delivered
      let trackingNumber: string | undefined
      if (status === 'Shipped' || status === 'Delivered') {
        trackingNumber = `1Z${String(randomInt(100000000, 999999999, rand))}${randomInt(10, 99, rand)}`
      }

      const orderNum = `SO-${year}-${String(orderIndex).padStart(4, '0')}`

      orders.push({
        id: `ORD-${String(orderIndex).padStart(4, '0')}`,
        orderNumber: orderNum,
        customerId: customer.id,
        customerName: customer.name,
        salesRepId: rep.id,
        salesRepName: rep.name,
        date: dateStr,
        status,
        fulfillmentStatus,
        trackingNumber,
        items,
        subtotal,
      })

      orderIndex++
    }
  }

  return orders
}

export const seedOrders: Order[] = generateOrders()

// =============================================================================
// 5. Monthly Revenue (derived from orders)
// =============================================================================

export interface MonthlyRevenue {
  month: string
  revenue: number
  orderCount: number
}

function deriveMonthlyRevenue(): MonthlyRevenue[] {
  const monthNames = [
    'Apr 2025', 'May 2025', 'Jun 2025', 'Jul 2025',
    'Aug 2025', 'Sep 2025', 'Oct 2025', 'Nov 2025',
    'Dec 2025', 'Jan 2026', 'Feb 2026', 'Mar 2026',
  ]

  const monthKeys = [
    '2025-04', '2025-05', '2025-06', '2025-07',
    '2025-08', '2025-09', '2025-10', '2025-11',
    '2025-12', '2026-01', '2026-02', '2026-03',
  ]

  return monthNames.map((name, idx) => {
    const key = monthKeys[idx]
    const monthOrders = seedOrders.filter(
      (o) => o.date.startsWith(key) && o.status !== 'Cancelled'
    )
    return {
      month: name,
      revenue: monthOrders.reduce((s, o) => s + o.subtotal, 0),
      orderCount: monthOrders.length,
    }
  })
}

export const seedMonthlyRevenue: MonthlyRevenue[] = deriveMonthlyRevenue()

// =============================================================================
// 6. Category Sales (derived from orders)
// =============================================================================

export interface CategorySales {
  category: string
  revenue: number
  percentage: number
}

function deriveCategorySales(): CategorySales[] {
  const categoryTotals: Record<string, number> = {}

  for (const order of seedOrders) {
    if (order.status === 'Cancelled') continue
    for (const item of order.items) {
      const product = seedProducts.find((p) => p.id === item.productId)
      if (product) {
        categoryTotals[product.category] = (categoryTotals[product.category] || 0) + item.total
      }
    }
  }

  const totalRevenue = Object.values(categoryTotals).reduce((s, v) => s + v, 0)

  return Object.entries(categoryTotals)
    .map(([category, revenue]) => ({
      category,
      revenue,
      percentage: totalRevenue > 0 ? Math.round((revenue / totalRevenue) * 1000) / 10 : 0,
    }))
    .sort((a, b) => b.revenue - a.revenue)
}

export const seedCategorySales: CategorySales[] = deriveCategorySales()

// =============================================================================
// 7. Sync Events (100+)
// =============================================================================

function generateSyncEvents(): SyncEvent[] {
  const rand = seededRandom(12345)
  const events: SyncEvent[] = []

  const automations: {
    automation: Automation
    source: SystemName
    target: SystemName
  }[] = [
    { automation: 'P1_OPP_TO_SO', source: 'salesforce', target: 'fishbowl' },
    { automation: 'P2_INVENTORY_SYNC', source: 'fishbowl', target: 'salesforce' },
    { automation: 'P3_QB_INVOICE_SYNC', source: 'quickbooks', target: 'salesforce' },
    { automation: 'P4_SHIPMENT_TRACKING', source: 'fishbowl', target: 'salesforce' },
    { automation: 'P5_QUOTE_PDF', source: 'salesforce', target: 'salesforce' },
    { automation: 'P6_LOW_STOCK_CHECK', source: 'fishbowl', target: 'internal' },
  ]

  // Status distribution: ~85% success, ~10% failed, ~3% pending, ~2% retrying
  const statusPool: SyncEvent['status'][] = [
    'success', 'success', 'success', 'success', 'success',
    'success', 'success', 'success', 'success', 'success',
    'success', 'success', 'success', 'success', 'success',
    'success', 'success',
    'failed', 'failed',
    'pending',
    'retrying',
  ]

  const now = new Date('2026-03-31T12:00:00Z')
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)

  for (let i = 0; i < 130; i++) {
    const auto = pick(automations, rand)
    const status = pick(statusPool, rand)

    // Random timestamp in last 30 days
    const tsOffset = rand() * 30 * 24 * 60 * 60 * 1000
    const ts = new Date(thirtyDaysAgo.getTime() + tsOffset)
    const createdAt = ts.toISOString()

    // SF-style record IDs
    const sfChars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'
    let sourceRecordId = ''
    if (auto.source === 'salesforce') {
      sourceRecordId = '006' + Array.from({ length: 15 }, () => sfChars[Math.floor(rand() * sfChars.length)]).join('')
    } else if (auto.source === 'fishbowl') {
      sourceRecordId = `FB-${randomInt(10000, 99999, rand)}`
    } else {
      sourceRecordId = `QB-${randomInt(1000, 9999, rand)}`
    }

    let targetRecordId: string | undefined
    if (status === 'success') {
      if (auto.target === 'salesforce') {
        targetRecordId = '006' + Array.from({ length: 15 }, () => sfChars[Math.floor(rand() * sfChars.length)]).join('')
      } else if (auto.target === 'fishbowl') {
        targetRecordId = `FB-SO-${randomInt(10000, 99999, rand)}`
      } else {
        targetRecordId = undefined
      }
    }

    const durationMs = status === 'success'
      ? randomInt(200, 3000, rand)
      : status === 'failed'
        ? randomInt(1000, 5000, rand)
        : undefined

    const completedAt = (status === 'success' || status === 'failed')
      ? new Date(ts.getTime() + (durationMs || 1000)).toISOString()
      : undefined

    let errorMessage: string | undefined
    if (status === 'failed') {
      const errors = [
        'INVALID_FIELD_VALUE: Fishbowl rejected partNumber — no matching part found',
        'SALESFORCE_API_ERROR: UNABLE_TO_LOCK_ROW — record locked by another process',
        'CONNECTION_TIMEOUT: Fishbowl API did not respond within 30s',
        'DUPLICATE_VALUE: Sales order already exists for this opportunity',
        'INSUFFICIENT_PERMISSIONS: OAuth token expired, re-authentication required',
        'RATE_LIMIT_EXCEEDED: Salesforce API rate limit reached (100/15min)',
        'VALIDATION_ERROR: Required field "Customer PO Number" is missing',
      ]
      errorMessage = pick(errors, rand)
    }

    const retryCount = status === 'retrying' ? randomInt(1, 3, rand) : status === 'failed' ? randomInt(0, 4, rand) : 0

    events.push({
      id: `EVT-${String(i + 1).padStart(4, '0')}`,
      created_at: createdAt,
      automation: auto.automation,
      source_system: auto.source,
      target_system: auto.target,
      source_record_id: sourceRecordId,
      target_record_id: targetRecordId ?? null,
      status,
      payload: null,
      response: null,
      error_message: errorMessage ?? null,
      retry_count: retryCount,
      max_retries: 4,
      next_retry_at: status === 'retrying'
        ? new Date(ts.getTime() + 5 * 60 * 1000).toISOString()
        : null,
      completed_at: completedAt ?? null,
      idempotency_key: `${auto.automation}:${sourceRecordId}:${dateToDay(ts)}`,
    })
  }

  // Sort by created_at descending (most recent first)
  return events.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
}

function dateToDay(d: Date): string {
  return d.toISOString().slice(0, 10)
}

export const seedSyncEvents: SyncEvent[] = generateSyncEvents()

// =============================================================================
// 8. Integration Status
// =============================================================================

export interface IntegrationStatusData {
  automation: string
  name: string
  description: string
  status: 'healthy' | 'warning' | 'error'
  lastRunAt: string
  lastRunDurationMs: number
  recordsProcessed: number
  successRate: number
  schedule: string
  isActive: boolean
  last7Days: { date: string; success: number; failed: number }[]
}

function generateIntegrationStatus(): IntegrationStatusData[] {
  const rand = seededRandom(9999)

  const defs: {
    automation: string
    name: string
    description: string
    schedule: string
    status: 'healthy' | 'warning' | 'error'
    successRate: number
    isActive: boolean
  }[] = [
    { automation: 'P1_OPP_TO_SO', name: 'Opportunity → Sales Order', description: 'Creates Fishbowl SO when SF Opportunity closes', schedule: 'Every 2 minutes', status: 'healthy', successRate: 97.2, isActive: true },
    { automation: 'P2_INVENTORY_SYNC', name: 'Inventory Sync', description: 'Syncs Fishbowl inventory levels to Salesforce Products', schedule: 'Every 15 minutes', status: 'healthy', successRate: 99.1, isActive: true },
    { automation: 'P3_QB_INVOICE_SYNC', name: 'Invoice/Payment Sync', description: 'Syncs QuickBooks invoices and payments to Salesforce', schedule: 'Every 1 hour', status: 'warning', successRate: 88.5, isActive: true },
    { automation: 'P4_SHIPMENT_TRACKING', name: 'Shipment Tracking', description: 'Syncs Fishbowl shipment tracking to Salesforce Opportunities', schedule: 'Every 15 minutes', status: 'healthy', successRate: 95.8, isActive: true },
    { automation: 'P5_QUOTE_PDF', name: 'Quote PDF Generation', description: 'Generates quote PDFs with real-time inventory data', schedule: 'On-demand', status: 'healthy', successRate: 100.0, isActive: true },
    { automation: 'P6_LOW_STOCK_CHECK', name: 'Low Stock Alerts', description: 'Checks inventory against reorder points after P2', schedule: 'After P2 completes', status: 'error', successRate: 72.0, isActive: true },
  ]

  const now = new Date('2026-03-31T12:00:00Z')

  return defs.map((def) => {
    const lastRunOffset = randomInt(1, 30, rand) * 60 * 1000 // 1-30 min ago
    const lastRunAt = new Date(now.getTime() - lastRunOffset).toISOString()

    // Generate last 7 days of success/fail counts
    const last7Days: { date: string; success: number; failed: number }[] = []
    for (let d = 6; d >= 0; d--) {
      const dayDate = new Date(now.getTime() - d * 24 * 60 * 60 * 1000)
      const dateStr = dayDate.toISOString().slice(0, 10)
      const totalRuns = def.schedule === 'On-demand' ? randomInt(0, 5, rand) : randomInt(10, 100, rand)
      const failRate = (100 - def.successRate) / 100
      const failed = Math.round(totalRuns * failRate * (0.5 + rand()))
      last7Days.push({ date: dateStr, success: totalRuns - failed, failed })
    }

    return {
      automation: def.automation,
      name: def.name,
      description: def.description,
      status: def.status,
      lastRunAt,
      lastRunDurationMs: randomInt(200, 4500, rand),
      recordsProcessed: randomInt(5, 250, rand),
      successRate: def.successRate,
      schedule: def.schedule,
      isActive: def.isActive,
      last7Days,
    }
  })
}

export const seedIntegrationStatus: IntegrationStatusData[] = generateIntegrationStatus()

// =============================================================================
// 9. Field Mappings
// =============================================================================

export const seedFieldMappings: FieldMapping[] = [
  // P1: Opportunity → Fishbowl Sales Order
  { id: 'FM-001', automation: 'P1_OPP_TO_SO', source_field: 'Account.Name', target_field: 'customer.name', is_required: true, transform: null, default_value: null, notes: 'Must match existing Fishbowl customer', created_at: '2026-03-01T00:00:00Z', updated_at: '2026-03-01T00:00:00Z' },
  { id: 'FM-002', automation: 'P1_OPP_TO_SO', source_field: 'Opportunity.CloseDate', target_field: 'dateScheduled', is_required: true, transform: 'ISO8601 → YYYY-MM-DD', default_value: null, notes: null, created_at: '2026-03-01T00:00:00Z', updated_at: '2026-03-01T00:00:00Z' },
  { id: 'FM-003', automation: 'P1_OPP_TO_SO', source_field: 'Opportunity.Name', target_field: 'note', is_required: false, transform: null, default_value: null, notes: 'Appended to SO notes', created_at: '2026-03-01T00:00:00Z', updated_at: '2026-03-01T00:00:00Z' },
  { id: 'FM-004', automation: 'P1_OPP_TO_SO', source_field: 'Opportunity.Id', target_field: 'customerPO', is_required: true, transform: null, default_value: null, notes: 'SF Opportunity ID used as PO reference', created_at: '2026-03-01T00:00:00Z', updated_at: '2026-03-01T00:00:00Z' },
  { id: 'FM-005', automation: 'P1_OPP_TO_SO', source_field: 'OpportunityLineItem.ProductCode', target_field: 'items[].partNumber', is_required: true, transform: null, default_value: null, notes: 'Must match Fishbowl Part Number exactly', created_at: '2026-03-01T00:00:00Z', updated_at: '2026-03-01T00:00:00Z' },
  { id: 'FM-006', automation: 'P1_OPP_TO_SO', source_field: 'OpportunityLineItem.Quantity', target_field: 'items[].quantity', is_required: true, transform: 'Integer', default_value: null, notes: null, created_at: '2026-03-01T00:00:00Z', updated_at: '2026-03-01T00:00:00Z' },
  { id: 'FM-007', automation: 'P1_OPP_TO_SO', source_field: 'OpportunityLineItem.UnitPrice', target_field: 'items[].unitPrice', is_required: true, transform: 'Decimal (2 places)', default_value: null, notes: null, created_at: '2026-03-01T00:00:00Z', updated_at: '2026-03-01T00:00:00Z' },
  { id: 'FM-008', automation: 'P1_OPP_TO_SO', source_field: 'Account.ShippingStreet', target_field: 'shipTo.address', is_required: true, transform: null, default_value: null, notes: null, created_at: '2026-03-01T00:00:00Z', updated_at: '2026-03-01T00:00:00Z' },
  { id: 'FM-009', automation: 'P1_OPP_TO_SO', source_field: 'Account.ShippingCity', target_field: 'shipTo.city', is_required: true, transform: null, default_value: null, notes: null, created_at: '2026-03-01T00:00:00Z', updated_at: '2026-03-01T00:00:00Z' },
  { id: 'FM-010', automation: 'P1_OPP_TO_SO', source_field: 'Account.ShippingState', target_field: 'shipTo.state', is_required: true, transform: null, default_value: null, notes: null, created_at: '2026-03-01T00:00:00Z', updated_at: '2026-03-01T00:00:00Z' },
  { id: 'FM-011', automation: 'P1_OPP_TO_SO', source_field: 'Account.ShippingPostalCode', target_field: 'shipTo.zip', is_required: true, transform: null, default_value: null, notes: null, created_at: '2026-03-01T00:00:00Z', updated_at: '2026-03-01T00:00:00Z' },
  { id: 'FM-012', automation: 'P1_OPP_TO_SO', source_field: 'Opportunity.Owner.Name', target_field: 'salesPerson', is_required: false, transform: null, default_value: 'House Account', notes: null, created_at: '2026-03-01T00:00:00Z', updated_at: '2026-03-01T00:00:00Z' },

  // P2: Fishbowl Inventory → Salesforce Product2
  { id: 'FM-013', automation: 'P2_INVENTORY_SYNC', source_field: 'part.number', target_field: 'Product2.ProductCode', is_required: true, transform: null, default_value: null, notes: 'Lookup key — must match', created_at: '2026-03-01T00:00:00Z', updated_at: '2026-03-01T00:00:00Z' },
  { id: 'FM-014', automation: 'P2_INVENTORY_SYNC', source_field: 'inventory.qtyOnHand', target_field: 'Product2.Qty_On_Hand__c', is_required: true, transform: 'Integer', default_value: null, notes: null, created_at: '2026-03-01T00:00:00Z', updated_at: '2026-03-01T00:00:00Z' },
  { id: 'FM-015', automation: 'P2_INVENTORY_SYNC', source_field: 'inventory.qtyAllocated', target_field: 'Product2.Qty_Allocated__c', is_required: false, transform: 'Integer', default_value: null, notes: null, created_at: '2026-03-01T00:00:00Z', updated_at: '2026-03-01T00:00:00Z' },
  { id: 'FM-016', automation: 'P2_INVENTORY_SYNC', source_field: 'inventory.qtyAvailable', target_field: 'Product2.Qty_Available__c', is_required: true, transform: 'qtyOnHand - qtyAllocated', default_value: null, notes: null, created_at: '2026-03-01T00:00:00Z', updated_at: '2026-03-01T00:00:00Z' },
  { id: 'FM-017', automation: 'P2_INVENTORY_SYNC', source_field: 'syncTimestamp', target_field: 'Product2.Last_Inventory_Sync__c', is_required: true, transform: 'ISO8601 DateTime', default_value: null, notes: null, created_at: '2026-03-01T00:00:00Z', updated_at: '2026-03-01T00:00:00Z' },

  // P4: Fishbowl Shipment → Salesforce Opportunity
  { id: 'FM-018', automation: 'P4_SHIPMENT_TRACKING', source_field: 'shipment.trackingNumber', target_field: 'Opportunity.Tracking_Number__c', is_required: true, transform: null, default_value: null, notes: null, created_at: '2026-03-01T00:00:00Z', updated_at: '2026-03-01T00:00:00Z' },
  { id: 'FM-019', automation: 'P4_SHIPMENT_TRACKING', source_field: 'shipment.carrier', target_field: 'Opportunity.Shipping_Carrier__c', is_required: false, transform: null, default_value: 'UPS', notes: null, created_at: '2026-03-01T00:00:00Z', updated_at: '2026-03-01T00:00:00Z' },
  { id: 'FM-020', automation: 'P4_SHIPMENT_TRACKING', source_field: 'shipment.status', target_field: 'Opportunity.Fulfillment_Status__c', is_required: true, transform: 'Map: Shipped→Shipped, Delivered→Delivered', default_value: null, notes: null, created_at: '2026-03-01T00:00:00Z', updated_at: '2026-03-01T00:00:00Z' },
  { id: 'FM-021', automation: 'P4_SHIPMENT_TRACKING', source_field: 'shipment.dateShipped', target_field: 'Opportunity.Ship_Date__c', is_required: false, transform: 'ISO8601 → Date', default_value: null, notes: null, created_at: '2026-03-01T00:00:00Z', updated_at: '2026-03-01T00:00:00Z' },
]

// =============================================================================
// 10. Connection Configs
// =============================================================================

// =============================================================================
// 11. Enhanced Sales Rep Data (for Sales Leaderboard & Analytics)
// =============================================================================

export interface SeedSalesRep {
  id: string
  name: string
  email: string
  region: string
  color: string
  revenueMTD: number
  revenueQTD: number
  revenueYTD: number
  dealsClosed: number
  dealsLost: number
  quotesSent: number
  profileCalls: number
  profileCallsChange: number
  avgDealSize: number
  avgDaysToClose: number
  pipelineValue: number
  winRate: number
  activityScore: 'hot' | 'active' | 'slow' | 'cold'
}

export const seedEnhancedSalesReps: SeedSalesRep[] = [
  {
    id: 'REP-001', name: 'Sarah Mitchell', email: 'sarah.mitchell@medshipllc.com', region: 'Midwest',
    color: '#452B90', revenueMTD: 167420, revenueQTD: 412800, revenueYTD: 1284500,
    dealsClosed: 14, dealsLost: 3, quotesSent: 28, profileCalls: 26, profileCallsChange: 30.0, avgDealSize: 11958, avgDaysToClose: 18,
    pipelineValue: 245000, winRate: 82.4, activityScore: 'hot',
  },
  {
    id: 'REP-002', name: 'James Thornton', email: 'james.thornton@medshipllc.com', region: 'Northeast',
    color: '#3A9B94', revenueMTD: 89200, revenueQTD: 248600, revenueYTD: 876300,
    dealsClosed: 9, dealsLost: 4, quotesSent: 19, profileCalls: 15, profileCallsChange: 15.4, avgDealSize: 9911, avgDaysToClose: 22,
    pipelineValue: 178000, winRate: 69.2, activityScore: 'active',
  },
  {
    id: 'REP-003', name: 'Maria Gonzalez', email: 'maria.gonzalez@medshipllc.com', region: 'Southeast',
    color: '#F8B940', revenueMTD: 72850, revenueQTD: 198400, revenueYTD: 724100,
    dealsClosed: 7, dealsLost: 5, quotesSent: 16, profileCalls: 14, profileCallsChange: 16.7, avgDealSize: 10407, avgDaysToClose: 25,
    pipelineValue: 132000, winRate: 58.3, activityScore: 'active',
  },
  {
    id: 'REP-004', name: 'David Kim', email: 'david.kim@medshipllc.com', region: 'West',
    color: '#58BAD7', revenueMTD: 31400, revenueQTD: 85200, revenueYTD: 312600,
    dealsClosed: 3, dealsLost: 8, quotesSent: 9, profileCalls: 7, profileCallsChange: -30.0, avgDealSize: 10467, avgDaysToClose: 34,
    pipelineValue: 64000, winRate: 27.3, activityScore: 'cold',
  },
  {
    id: 'REP-005', name: 'Lisa Chen', email: 'lisa.chen@medshipllc.com', region: 'South Central',
    color: '#FF9F00', revenueMTD: 42600, revenueQTD: 42600, revenueYTD: 42600,
    dealsClosed: 4, dealsLost: 1, quotesSent: 22, profileCalls: 11, profileCallsChange: 0, avgDealSize: 10650, avgDaysToClose: 15,
    pipelineValue: 198000, winRate: 80.0, activityScore: 'hot',
  },
]

// =============================================================================
// 12. Pipeline Data
// =============================================================================

export interface SeedPipelineStage {
  stage: string
  count: number
  value: number
  color: string
}

export const seedPipelineStages: SeedPipelineStage[] = [
  { stage: 'Prospecting', count: 12, value: 284000, color: '#93C5FD' },
  { stage: 'Qualification', count: 8, value: 196000, color: '#60A5FA' },
  { stage: 'Proposal', count: 6, value: 168000, color: '#3B82F6' },
  { stage: 'Negotiation', count: 4, value: 125000, color: '#2563EB' },
  { stage: 'Closed Won', count: 37, value: 403470, color: '#3A9B94' },
  { stage: 'Closed Lost', count: 9, value: 87000, color: '#FF5E5E' },
]

// =============================================================================
// 13. Sales Activity Feed
// =============================================================================

export interface SeedSalesActivity {
  id: string
  repId: string
  repName: string
  type: 'deal_closed' | 'quote_sent' | 'opportunity_created' | 'deal_lost' | 'profile_call'
  customerName: string
  amount: number
  description: string
  timestamp: string
  contactName?: string
  callOutcome?: string
  productsDiscussed?: string[]
}

export const seedSalesActivities: SeedSalesActivity[] = [
  { id: 'ACT-001', repId: 'REP-001', repName: 'Sarah Mitchell', type: 'deal_closed', customerName: 'Rush University College of Nursing', amount: 72000, description: 'Closed deal with Rush University College of Nursing for $72,000', timestamp: '2026-03-31T10:45:00Z' },
  { id: 'ACT-P01', repId: 'REP-001', repName: 'Sarah Mitchell', type: 'profile_call', customerName: 'Mayo Clinic Simulation Center', amount: 0, description: 'Completed profile call with Dr. Patricia Hammond at Mayo Clinic Simulation Center', timestamp: '2026-03-31T10:30:00Z', contactName: 'Dr. Patricia Hammond', callOutcome: 'Quote Requested', productsDiscussed: ['Pyxis MedStation', 'Simulation Manikins'] },
  { id: 'ACT-002', repId: 'REP-005', repName: 'Lisa Chen', type: 'quote_sent', customerName: 'Houston Community College Nursing', amount: 18500, description: 'Sent quote to Houston Community College Nursing for $18,500', timestamp: '2026-03-31T10:20:00Z' },
  { id: 'ACT-P02', repId: 'REP-005', repName: 'Lisa Chen', type: 'profile_call', customerName: 'Rasmussen University School of Nursing', amount: 0, description: 'Completed profile call with Dean Robert Chen at Rasmussen University', timestamp: '2026-03-31T09:45:00Z', contactName: 'Dean Robert Chen', callOutcome: 'Interested - Next Steps', productsDiscussed: ['Skills Lab Kits', 'IV Trainers'] },
  { id: 'ACT-003', repId: 'REP-002', repName: 'James Thornton', type: 'opportunity_created', customerName: 'Columbia University School of Nursing', amount: 45000, description: 'Created new opportunity: Columbia University SimLab Expansion', timestamp: '2026-03-31T09:30:00Z' },
  { id: 'ACT-P03', repId: 'REP-002', repName: 'James Thornton', type: 'profile_call', customerName: 'Johns Hopkins School of Nursing', amount: 0, description: 'Completed profile call with Prof. Linda Martinez at Johns Hopkins', timestamp: '2026-03-31T09:00:00Z', contactName: 'Prof. Linda Martinez', callOutcome: 'Scheduled Demo', productsDiscussed: ['Simulation Manikins', 'Hospital Beds'] },
  { id: 'ACT-004', repId: 'REP-001', repName: 'Sarah Mitchell', type: 'quote_sent', customerName: 'University of Michigan School of Nursing', amount: 28000, description: 'Sent quote to University of Michigan School of Nursing for $28,000', timestamp: '2026-03-31T08:15:00Z' },
  { id: 'ACT-P04', repId: 'REP-003', repName: 'Maria Gonzalez', type: 'profile_call', customerName: 'Duke University School of Nursing', amount: 0, description: 'Completed profile call with Dr. Angela Foster at Duke University', timestamp: '2026-03-31T08:00:00Z', contactName: 'Dr. Angela Foster', callOutcome: 'Needs Follow-Up', productsDiscussed: ['Pyxis MedStation'] },
  { id: 'ACT-005', repId: 'REP-004', repName: 'David Kim', type: 'deal_lost', customerName: 'UCLA School of Nursing', amount: 38000, description: 'Lost deal: UCLA School of Nursing — went with competitor pricing', timestamp: '2026-03-31T07:50:00Z' },
  { id: 'ACT-P05', repId: 'REP-001', repName: 'Sarah Mitchell', type: 'profile_call', customerName: 'Advocate Aurora Health Training Center', amount: 0, description: 'Completed profile call with Karen Williams at Advocate Aurora', timestamp: '2026-03-30T17:00:00Z', contactName: 'Karen Williams', callOutcome: 'Interested - Next Steps', productsDiscussed: ['Simulation Manikins', 'Vital Signs Monitors', 'Consumables'] },
  { id: 'ACT-006', repId: 'REP-003', repName: 'Maria Gonzalez', type: 'deal_closed', customerName: 'Emory University Nell Hodgson Woodruff School of Nursing', amount: 32000, description: 'Closed deal with Emory University for $32,000', timestamp: '2026-03-30T16:30:00Z' },
  { id: 'ACT-P06', repId: 'REP-004', repName: 'David Kim', type: 'profile_call', customerName: 'UCLA School of Nursing', amount: 0, description: 'Completed profile call with Prof. Steven Park at UCLA', timestamp: '2026-03-30T16:00:00Z', contactName: 'Prof. Steven Park', callOutcome: 'Left Voicemail', productsDiscussed: ['Hospital Beds'] },
  { id: 'ACT-007', repId: 'REP-005', repName: 'Lisa Chen', type: 'opportunity_created', customerName: 'Rasmussen University School of Nursing', amount: 22000, description: 'Created new opportunity: Rasmussen Nursing Kit Bulk Order', timestamp: '2026-03-30T15:45:00Z' },
  { id: 'ACT-P07', repId: 'REP-005', repName: 'Lisa Chen', type: 'profile_call', customerName: 'Chamberlain University College of Nursing', amount: 0, description: 'Completed profile call with Dr. Michelle Torres at Chamberlain', timestamp: '2026-03-30T15:15:00Z', contactName: 'Dr. Michelle Torres', callOutcome: 'Interested - Next Steps', productsDiscussed: ['Skills Lab Kits', 'Consumables'] },
  { id: 'ACT-008', repId: 'REP-002', repName: 'James Thornton', type: 'deal_closed', customerName: 'NYU Rory Meyers College of Nursing', amount: 48000, description: 'Closed deal with NYU Rory Meyers for $48,000', timestamp: '2026-03-30T14:20:00Z' },
  { id: 'ACT-P08', repId: 'REP-001', repName: 'Sarah Mitchell', type: 'profile_call', customerName: 'University of Illinois Chicago College of Nursing', amount: 0, description: 'Completed profile call with Dr. James Okafor at UIC', timestamp: '2026-03-30T14:00:00Z', contactName: 'Dr. James Okafor', callOutcome: 'Quote Requested', productsDiscussed: ['Pyxis MedStation', 'Hospital Beds'] },
  { id: 'ACT-009', repId: 'REP-001', repName: 'Sarah Mitchell', type: 'quote_sent', customerName: 'Northwestern Memorial Hospital Education', amount: 65000, description: 'Sent quote to Northwestern Memorial for $65,000', timestamp: '2026-03-30T13:00:00Z' },
  { id: 'ACT-P09', repId: 'REP-002', repName: 'James Thornton', type: 'profile_call', customerName: 'Massachusetts General Hospital Sim Center', amount: 0, description: 'Completed profile call with Dr. Nancy Sullivan at Mass General', timestamp: '2026-03-30T12:30:00Z', contactName: 'Dr. Nancy Sullivan', callOutcome: 'Needs Follow-Up', productsDiscussed: ['Simulation Manikins'] },
  { id: 'ACT-010', repId: 'REP-003', repName: 'Maria Gonzalez', type: 'quote_sent', customerName: 'Duke University School of Nursing', amount: 28500, description: 'Sent quote to Duke University for $28,500', timestamp: '2026-03-30T11:45:00Z' },
  { id: 'ACT-011', repId: 'REP-004', repName: 'David Kim', type: 'deal_lost', customerName: 'University of Washington School of Nursing', amount: 22000, description: 'Lost deal: UW Nursing — budget frozen for Q1', timestamp: '2026-03-30T10:30:00Z' },
  { id: 'ACT-012', repId: 'REP-005', repName: 'Lisa Chen', type: 'deal_closed', customerName: 'ECPI University Nursing', amount: 15200, description: 'Closed deal with ECPI University for $15,200', timestamp: '2026-03-30T09:15:00Z' },
  { id: 'ACT-013', repId: 'REP-001', repName: 'Sarah Mitchell', type: 'deal_closed', customerName: 'Loyola University Chicago Marcella Niehoff School of Nursing', amount: 42500, description: 'Closed deal with Loyola Chicago for $42,500', timestamp: '2026-03-30T08:00:00Z' },
  { id: 'ACT-014', repId: 'REP-002', repName: 'James Thornton', type: 'quote_sent', customerName: 'Johns Hopkins School of Nursing', amount: 55000, description: 'Sent quote to Johns Hopkins for $55,000', timestamp: '2026-03-29T17:00:00Z' },
  { id: 'ACT-015', repId: 'REP-003', repName: 'Maria Gonzalez', type: 'opportunity_created', customerName: 'Vanderbilt University School of Nursing', amount: 35000, description: 'Created new opportunity: Vanderbilt Sim Equipment Refresh', timestamp: '2026-03-29T16:00:00Z' },
  { id: 'ACT-016', repId: 'REP-004', repName: 'David Kim', type: 'quote_sent', customerName: 'Mayo Clinic Simulation Center', amount: 78000, description: 'Sent quote to Mayo Clinic Sim Center for $78,000', timestamp: '2026-03-29T15:20:00Z' },
  { id: 'ACT-017', repId: 'REP-001', repName: 'Sarah Mitchell', type: 'deal_closed', customerName: 'University of Illinois Chicago College of Nursing', amount: 28400, description: 'Closed deal with UIC for $28,400', timestamp: '2026-03-29T14:10:00Z' },
  { id: 'ACT-018', repId: 'REP-005', repName: 'Lisa Chen', type: 'quote_sent', customerName: 'Chamberlain University College of Nursing', amount: 42000, description: 'Sent quote to Chamberlain University for $42,000', timestamp: '2026-03-29T13:30:00Z' },
  { id: 'ACT-019', repId: 'REP-002', repName: 'James Thornton', type: 'deal_closed', customerName: 'University of Pennsylvania School of Nursing', amount: 38600, description: 'Closed deal with UPenn Nursing for $38,600', timestamp: '2026-03-29T11:00:00Z' },
  { id: 'ACT-020', repId: 'REP-004', repName: 'David Kim', type: 'deal_lost', customerName: 'Cleveland Clinic Education Institute', amount: 32000, description: 'Lost deal: Cleveland Clinic — decided to delay purchase to Q3', timestamp: '2026-03-29T10:00:00Z' },
  { id: 'ACT-021', repId: 'REP-003', repName: 'Maria Gonzalez', type: 'deal_closed', customerName: 'Miami Dade College Nursing', amount: 12850, description: 'Closed deal with Miami Dade College for $12,850', timestamp: '2026-03-29T09:30:00Z' },
  { id: 'ACT-022', repId: 'REP-001', repName: 'Sarah Mitchell', type: 'opportunity_created', customerName: 'Advocate Aurora Health Training Center', amount: 58000, description: 'Created new opportunity: Advocate Aurora SimLab Build-Out', timestamp: '2026-03-29T08:45:00Z' },
  { id: 'ACT-023', repId: 'REP-005', repName: 'Lisa Chen', type: 'deal_closed', customerName: 'Herzing University Nursing Program', amount: 14800, description: 'Closed deal with Herzing University for $14,800', timestamp: '2026-03-29T08:00:00Z' },
  { id: 'ACT-024', repId: 'REP-002', repName: 'James Thornton', type: 'quote_sent', customerName: 'Case Western Reserve Frances Payne Bolton School of Nursing', amount: 34000, description: 'Sent quote to Case Western Reserve for $34,000', timestamp: '2026-03-29T07:30:00Z' },
  { id: 'ACT-025', repId: 'REP-003', repName: 'Maria Gonzalez', type: 'quote_sent', customerName: 'College of DuPage Nursing Program', amount: 8500, description: 'Sent quote to College of DuPage for $8,500', timestamp: '2026-03-29T07:00:00Z' },
]

// =============================================================================
// 14. Quote Data
// =============================================================================

export interface SeedQuote {
  id: string
  date: string
  repName: string
  customerName: string
  amount: number
  status: 'sent' | 'viewed' | 'accepted' | 'expired' | 'rejected'
  daysOpen: number
}

export const seedQuotes: SeedQuote[] = [
  { id: 'QT-001', date: '2026-03-31', repName: 'Sarah Mitchell', customerName: 'University of Michigan School of Nursing', amount: 28000, status: 'sent', daysOpen: 0 },
  { id: 'QT-002', date: '2026-03-31', repName: 'Lisa Chen', customerName: 'Houston Community College Nursing', amount: 18500, status: 'sent', daysOpen: 0 },
  { id: 'QT-003', date: '2026-03-30', repName: 'Sarah Mitchell', customerName: 'Northwestern Memorial Hospital Education', amount: 65000, status: 'viewed', daysOpen: 1 },
  { id: 'QT-004', date: '2026-03-30', repName: 'Maria Gonzalez', customerName: 'Duke University School of Nursing', amount: 28500, status: 'viewed', daysOpen: 1 },
  { id: 'QT-005', date: '2026-03-29', repName: 'James Thornton', customerName: 'Johns Hopkins School of Nursing', amount: 55000, status: 'viewed', daysOpen: 2 },
  { id: 'QT-006', date: '2026-03-29', repName: 'David Kim', customerName: 'Mayo Clinic Simulation Center', amount: 78000, status: 'sent', daysOpen: 2 },
  { id: 'QT-007', date: '2026-03-29', repName: 'Lisa Chen', customerName: 'Chamberlain University College of Nursing', amount: 42000, status: 'viewed', daysOpen: 2 },
  { id: 'QT-008', date: '2026-03-29', repName: 'James Thornton', customerName: 'Case Western Reserve Frances Payne Bolton School of Nursing', amount: 34000, status: 'sent', daysOpen: 2 },
  { id: 'QT-009', date: '2026-03-29', repName: 'Maria Gonzalez', customerName: 'College of DuPage Nursing Program', amount: 8500, status: 'accepted', daysOpen: 2 },
  { id: 'QT-010', date: '2026-03-28', repName: 'Sarah Mitchell', customerName: 'Rush University College of Nursing', amount: 72000, status: 'accepted', daysOpen: 3 },
  { id: 'QT-011', date: '2026-03-27', repName: 'James Thornton', customerName: 'NYU Rory Meyers College of Nursing', amount: 48000, status: 'accepted', daysOpen: 4 },
  { id: 'QT-012', date: '2026-03-27', repName: 'Maria Gonzalez', customerName: 'Emory University Nell Hodgson Woodruff School of Nursing', amount: 32000, status: 'accepted', daysOpen: 4 },
  { id: 'QT-013', date: '2026-03-26', repName: 'David Kim', customerName: 'UCLA School of Nursing', amount: 38000, status: 'rejected', daysOpen: 5 },
  { id: 'QT-014', date: '2026-03-26', repName: 'Lisa Chen', customerName: 'ECPI University Nursing', amount: 15200, status: 'accepted', daysOpen: 5 },
  { id: 'QT-015', date: '2026-03-25', repName: 'Sarah Mitchell', customerName: 'Loyola University Chicago Marcella Niehoff School of Nursing', amount: 42500, status: 'accepted', daysOpen: 6 },
  { id: 'QT-016', date: '2026-03-25', repName: 'James Thornton', customerName: 'University of Pennsylvania School of Nursing', amount: 38600, status: 'accepted', daysOpen: 6 },
  { id: 'QT-017', date: '2026-03-24', repName: 'David Kim', customerName: 'University of Washington School of Nursing', amount: 22000, status: 'rejected', daysOpen: 7 },
  { id: 'QT-018', date: '2026-03-24', repName: 'Maria Gonzalez', customerName: 'Miami Dade College Nursing', amount: 12850, status: 'accepted', daysOpen: 7 },
  { id: 'QT-019', date: '2026-03-23', repName: 'Lisa Chen', customerName: 'Herzing University Nursing Program', amount: 14800, status: 'accepted', daysOpen: 8 },
  { id: 'QT-020', date: '2026-03-22', repName: 'Sarah Mitchell', customerName: 'University of Illinois Chicago College of Nursing', amount: 28400, status: 'accepted', daysOpen: 9 },
  { id: 'QT-021', date: '2026-03-21', repName: 'David Kim', customerName: 'Cleveland Clinic Education Institute', amount: 32000, status: 'rejected', daysOpen: 10 },
  { id: 'QT-022', date: '2026-03-20', repName: 'James Thornton', customerName: 'University of Pittsburgh School of Nursing', amount: 24500, status: 'accepted', daysOpen: 11 },
  { id: 'QT-023', date: '2026-03-19', repName: 'Maria Gonzalez', customerName: 'Moraine Valley Community College', amount: 6200, status: 'accepted', daysOpen: 12 },
  { id: 'QT-024', date: '2026-03-18', repName: 'Sarah Mitchell', customerName: 'Advocate Aurora Health Training Center', amount: 44000, status: 'expired', daysOpen: 13 },
  { id: 'QT-025', date: '2026-03-17', repName: 'Lisa Chen', customerName: 'Rasmussen University School of Nursing', amount: 19500, status: 'viewed', daysOpen: 14 },
  { id: 'QT-026', date: '2026-03-15', repName: 'David Kim', customerName: 'Oakton College Nursing Program', amount: 5800, status: 'expired', daysOpen: 16 },
  { id: 'QT-027', date: '2026-03-14', repName: 'James Thornton', customerName: 'Massachusetts General Hospital Sim Center', amount: 62000, status: 'accepted', daysOpen: 17 },
  { id: 'QT-028', date: '2026-03-12', repName: 'Sarah Mitchell', customerName: 'College of Lake County Nursing', amount: 7800, status: 'accepted', daysOpen: 19 },
  { id: 'QT-029', date: '2026-03-10', repName: 'Maria Gonzalez', customerName: 'Harper College Nursing Program', amount: 4900, status: 'expired', daysOpen: 21 },
  { id: 'QT-030', date: '2026-03-08', repName: 'David Kim', customerName: 'Triton College Nursing Program', amount: 3800, status: 'rejected', daysOpen: 23 },
  { id: 'QT-031', date: '2026-03-06', repName: 'Lisa Chen', customerName: 'Chamberlain University College of Nursing', amount: 35000, status: 'accepted', daysOpen: 25 },
  { id: 'QT-032', date: '2026-03-04', repName: 'James Thornton', customerName: 'Columbia University School of Nursing', amount: 45000, status: 'viewed', daysOpen: 27 },
  { id: 'QT-033', date: '2026-03-02', repName: 'Sarah Mitchell', customerName: 'Case Western Reserve Frances Payne Bolton School of Nursing', amount: 29000, status: 'accepted', daysOpen: 29 },
  { id: 'QT-034', date: '2026-03-01', repName: 'Maria Gonzalez', customerName: 'Vanderbilt University School of Nursing', amount: 35000, status: 'sent', daysOpen: 30 },
]

// =============================================================================
// 15. Monthly Revenue by Rep (last 6 months)
// =============================================================================

export interface SeedMonthlyRepRevenue {
  month: string
  [repName: string]: number | string
}

export const seedMonthlyRepRevenue: SeedMonthlyRepRevenue[] = [
  { month: 'Oct 2025', 'Sarah Mitchell': 98400, 'James Thornton': 72100, 'Maria Gonzalez': 58200, 'David Kim': 45600, 'Lisa Chen': 0 },
  { month: 'Nov 2025', 'Sarah Mitchell': 112000, 'James Thornton': 64500, 'Maria Gonzalez': 51800, 'David Kim': 38200, 'Lisa Chen': 0 },
  { month: 'Dec 2025', 'Sarah Mitchell': 78500, 'James Thornton': 48200, 'Maria Gonzalez': 42100, 'David Kim': 28400, 'Lisa Chen': 0 },
  { month: 'Jan 2026', 'Sarah Mitchell': 142800, 'James Thornton': 88400, 'Maria Gonzalez': 68200, 'David Kim': 32800, 'Lisa Chen': 0 },
  { month: 'Feb 2026', 'Sarah Mitchell': 102580, 'James Thornton': 71000, 'Maria Gonzalez': 57350, 'David Kim': 21000, 'Lisa Chen': 0 },
  { month: 'Mar 2026', 'Sarah Mitchell': 167420, 'James Thornton': 89200, 'Maria Gonzalez': 72850, 'David Kim': 31400, 'Lisa Chen': 42600 },
]

// =============================================================================
// 16. Pipeline by Rep
// =============================================================================

export interface SeedPipelineByRep {
  repName: string
  Prospecting: number
  Qualification: number
  Proposal: number
  Negotiation: number
}

export const seedPipelineByRep: SeedPipelineByRep[] = [
  { repName: 'Sarah Mitchell', Prospecting: 58000, Qualification: 65000, Proposal: 72000, Negotiation: 50000 },
  { repName: 'James Thornton', Prospecting: 45000, Qualification: 48000, Proposal: 55000, Negotiation: 30000 },
  { repName: 'Maria Gonzalez', Prospecting: 38000, Qualification: 32000, Proposal: 35000, Negotiation: 27000 },
  { repName: 'David Kim', Prospecting: 22000, Qualification: 18000, Proposal: 14000, Negotiation: 10000 },
  { repName: 'Lisa Chen', Prospecting: 68000, Qualification: 52000, Proposal: 48000, Negotiation: 30000 },
]

// =============================================================================
// 10. Connection Configs
// =============================================================================

export const seedConnectionConfigs: ConnectionConfig[] = [
  {
    id: 'CONN-001',
    system_name: 'salesforce',
    config: {},
    is_active: true,
    last_connected_at: '2026-03-31T11:58:00Z',
    last_error: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-03-31T11:58:00Z',
  },
  {
    id: 'CONN-002',
    system_name: 'fishbowl',
    config: {},
    is_active: true,
    last_connected_at: '2026-03-31T11:55:00Z',
    last_error: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-03-31T11:55:00Z',
  },
  {
    id: 'CONN-003',
    system_name: 'quickbooks',
    config: {},
    is_active: true,
    last_connected_at: '2026-03-31T10:30:00Z',
    last_error: 'Token refresh failed at 10:15 — recovered on retry',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-03-31T10:30:00Z',
  },
  {
    id: 'CONN-004',
    system_name: 'easypost',
    config: {},
    is_active: false,
    last_connected_at: '2026-03-15T14:00:00Z',
    last_error: 'Integration paused — awaiting EasyPost account upgrade',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-03-15T14:00:00Z',
  },
]

// =============================================================================
// 17. Profile Call Data
// =============================================================================

export type ProfileCallType = 'Initial Discovery' | 'Follow-Up' | 'Product Demo' | 'Needs Assessment' | 'Budget Discussion' | 'Contract Review'
export type ProfileCallOutcome = 'Interested - Next Steps' | 'Needs Follow-Up' | 'Not Interested' | 'No Answer' | 'Left Voicemail' | 'Scheduled Demo' | 'Quote Requested'

export interface SeedProfileCall {
  id: string
  subject: string
  repId: string
  repName: string
  accountName: string
  contactName: string
  activityDate: string
  callType: ProfileCallType
  callOutcome: ProfileCallOutcome
  productsDiscussed: string[]
  programSize: string
  currentSupplier: string | null
  budgetAvailable: number | null
  budgetTimeframe: string | null
  followUpDate: string | null
  convertedToOpp: boolean
  relatedOpportunityName: string | null
  callDurationMinutes: number
  callNotesSummary: string
  competitorIntel: string | null
}

export interface SeedWeeklyCallVolume {
  weekStart: string
  [repName: string]: number | string
}

const profileCallProducts = ['Pyxis MedStation', 'Simulation Manikins', 'Hospital Beds', 'IV Trainers', 'Skills Lab Kits', 'Vital Signs Monitors', 'Consumables', 'Other']
const programSizes = ['Small (<50 students)', 'Medium (50-150 students)', 'Large (150-500 students)', 'Enterprise (500+ students)']
const budgetTimeframes = ['This Quarter', 'Next Quarter', 'This Fiscal Year', 'Next Fiscal Year', 'Unknown']
const competitors = ['Pocket Nurse', 'Laerdal direct sales', 'Local distributor', 'State contract vendor']

const profileCallContacts = [
  'Dr. Patricia Hammond', 'Prof. Linda Martinez', 'Dean Robert Chen', 'Dr. Angela Foster',
  'Karen Williams, RN', 'Dr. James Okafor', 'Prof. Susan Reilly', 'Dr. Michelle Torres',
  'Dr. Nancy Sullivan', 'Prof. Steven Park', 'Lisa Nakamura, MSN', 'Dr. Barbara Klein',
  'Dean Cheryl Washington', 'Prof. Thomas Reeder', 'Dr. Priya Sharma', 'Janet Cooper, RN',
  'Dr. David Moreno', 'Prof. Amy Richardson', 'Dr. Kwame Asante', 'Rachel Goldstein, MSN',
  'Dr. Catherine Byrne', 'Prof. Michael Stein', 'Dr. Yolanda Cruz', 'Dean Frank Romano',
  'Dr. Heather Banks', 'Prof. Douglas Wu', 'Dr. Samantha Obi', 'Dr. Robert Tran',
  'Prof. Elena Vasquez', 'Dr. Timothy Brooks',
]

const profileCallNotes: Record<string, string[]> = {
  'Sarah Mitchell': [
    'Discussed upgrading their simulation lab from Laerdal to Gaumard manikins. Very interested in Pediatric HAL. Currently running 3 cohorts of 40 students. Budget approval expected by end of fiscal year. Follow up with ROI comparison sheet.',
    'Comprehensive needs assessment for new nursing wing. They need 4 Pyxis units and 6 hospital beds. Decision maker is the Dean — scheduling follow-up with both. Budget is pre-approved from a capital improvement grant.',
    'Product demo for SimMan 3G PLUS went very well. Faculty were impressed with the wireless capability. They currently use older SimMan classics from 2018. Want pricing for 2 units plus service contract.',
    'Budget discussion for FY2027 capital equipment. They have $180K earmarked for simulation upgrades. Competing against Pocket Nurse bid that came in 10% lower. Need to emphasize our service SLA advantage.',
    'Follow-up from last month demo. Lab coordinator confirmed they will move forward with the Pyxis order. Waiting on PO from procurement — should have it within 2 weeks. Big win for Q2.',
    'Initial call with new contact at their satellite campus. They are building a brand new simulation center opening Fall 2026. Early-stage but could be a $200K+ opportunity. Sending our capabilities deck.',
    'Contract review meeting — walked through MSA terms and pricing tiers. They want volume pricing across 3 campuses. Legal is reviewing our standard terms. Expecting signed contract by mid-April.',
    'Follow-up on IV trainer order. They added 10 more venipuncture arms and suture kits to the existing PO. Quick add-on sale. Also asked about our wound care simulation kits for their advanced nursing program.',
    'Needs assessment for their NCLEX prep lab. Currently using outdated equipment from 2015. Program director wants full modernization. Setting up on-site demo for department chairs next week.',
    'Discussed clinical rotation kit requirements. They need 60 kits for fall enrollment. Price-sensitive — comparing against Pocket Nurse bundled kits. Our quality is better but need to sharpen pricing.',
    'Deep dive on Pyxis MedStation ES features. Their current automated dispensing cabinet is EOL in June. Urgent timeline. Decision committee meets April 5th. Sending formal proposal Monday.',
    'Product demo for vital signs monitors and diagnostic equipment. Strong interest from the new assistant dean. They want to standardize across all labs. Potential $50K order.',
    'Follow-up call regarding simulation manikin maintenance contracts. Renewed 3-year service agreement. Also discussed upcoming Lucina childbirth simulator purchase for OB program.',
  ],
  'James Thornton': [
    'Initial discovery with new nursing program. They are launching an accelerated BSN in Fall 2026 and need a complete sim lab build-out. Early stage but high potential. Sending catalog and scheduling campus visit.',
    'Follow-up on simulation equipment quote. They are comparing us against Laerdal direct. Our bundled pricing with service is competitive. Decision expected in 3 weeks.',
    'Needs assessment for their skills lab refresh. Current equipment is 5+ years old. Need new IV arms, catheter trainers, and airway management trainers. Moderate budget available.',
    'Product demo of Nursing Anne simulator. Faculty liked the clinical scenario programming. Concern about training time for new equipment. Offered complimentary onboarding sessions.',
    'Budget discussion — their allocation for FY2027 is lower than expected due to enrollment dip. May need to phase the purchase across two fiscal years. Adjusting proposal accordingly.',
    'Follow-up call — left voicemail for purchasing director. Will try again Thursday. They have an open PO that needs to be processed before fiscal year end.',
    'Contract review for annual consumables supply agreement. Straightforward renewal with 3% price adjustment. They asked about adding ECG electrode pads to the standing order.',
    'Discussed expanding their hospital sim center capabilities. Interested in high-fidelity manikins for resident training. Different budget pool than nursing — working with medical education dept.',
  ],
  'Maria Gonzalez': [
    'Initial discovery call with lab coordinator. School is expanding their LPN-to-RN bridge program and needs additional simulation capacity. Currently using basic task trainers only.',
    'Follow-up on skills lab kit proposal. Budget holder is the VP of Academic Affairs. She confirmed budget is available this fiscal year but needs to see competitive bids first.',
    'Product demo via Zoom — showed SimNewB newborn simulator capabilities. They have a strong maternal-child health program. Very interested but need approval from the board of trustees.',
    'Needs assessment for consumables restock. They go through IV tubing and replacement skins quickly. Setting up quarterly auto-ship to avoid stockouts during clinical rotations.',
    'Budget discussion — program is growing 15% year-over-year. They want to invest in capital equipment but need to justify ROI to administration. Sending our ROI calculator spreadsheet.',
    'Follow-up from trade show introduction at INACSL. They remembered our booth demo. Warm lead — scheduling on-site visit for next month. Interested in full sim lab consultation.',
    'Discussed competitive landscape. They got an aggressive bid from Pocket Nurse. Our differentiator is the integrated service contract and faster delivery times. Need to respond by Friday.',
    'Contract review for multi-year equipment lease option. Their CFO prefers leasing over capital purchase for cash flow reasons. Working with our finance team on lease terms.',
  ],
  'David Kim': [
    'Called purchasing contact — no answer. Will try again next week.',
    'Left voicemail for lab coordinator about scheduling a product demo. This is the 3rd attempt — may need to find a different contact.',
    'Brief call with department secretary. Contact is traveling until next week. Noted interest in hospital beds for their new sim lab. Very preliminary.',
    'Initial discovery — short call. They are exploring options but no budget allocated yet. Probably a next-fiscal-year opportunity. Added to nurture list.',
    'Follow-up from email inquiry. They downloaded our catalog and have questions about Pyxis compatibility. Call was brief — 8 minutes. Sending technical specs.',
    'Left voicemail for dean regarding simulation equipment consultation. She has been difficult to reach. Need to try different approach — maybe through faculty referral.',
    'Had a productive call with new assistant professor. She is advocating internally for simulation upgrades. Good champion but not the budget holder. Sent her our case studies.',
  ],
  'Lisa Chen': [
    'Initial discovery call with new prospect. They are a growing for-profit nursing program expanding to 3 new campuses. Massive potential opportunity. Very early stage — building relationship.',
    'Needs assessment for their existing simulation lab. Currently underequipped — only 2 basic manikins for 120 students. Clear need for significant upgrade. Program director very engaged.',
    'Initial discovery with community college nursing program. They received a state grant for simulation equipment. $75K to spend by September. Moving fast on this one.',
    'Follow-up on needs assessment. Program director is building an internal business case. I offered to help draft the equipment justification document. She was very appreciative.',
    'Product demo for skills lab kits and consumables. Showed the complete nursing fundamentals kit. They want to pilot with one cohort first. Quick win potential — $12K order.',
    'Initial discovery — reached out to hospital training center. They train 200+ nurses per year and need to modernize. Currently using competitors equipment. Long sales cycle but big upside.',
    'Needs assessment for clinical rotation supplies. They standardize kits across 4 campuses. Potential bulk deal. Introduced them to our volume pricing program.',
    'Initial discovery with small community college. Limited budget but enthusiastic faculty. Good long-term relationship potential. Sent starter kit options under $5K.',
    'Follow-up on pilot kit proposal. They approved the pilot. Processing PO this week. If successful, they will roll out to all cohorts in Fall — $45K opportunity.',
    'Budget discussion with procurement director. They have end-of-year funds that need to be committed by March 31st. Rushing a quote for IV trainers and catheter simulators.',
    'Needs assessment call with dean of nursing. Comprehensive discussion about 3-year equipment roadmap. She shared their strategic plan. Great intel for long-term account planning.',
  ],
}

const profileCallCompetitorIntel: Record<string, (string | null)[]> = {
  'Sarah Mitchell': [
    'Pocket Nurse has been aggressively pricing bundled skill kits 10-15% below our list price. They are offering free shipping on orders over $5K.',
    null,
    'Laerdal direct sales rep visited last month and offered a trade-in program for old SimMan units. We need a competitive trade-in offer.',
    'Pocket Nurse bid came in at $162K vs our $180K. They are bundling maintenance for year 1. We need to match or justify the delta.',
    null,
    null,
    null,
    null,
    'Current equipment is mostly Laerdal with some Gaumard. They have existing Laerdal service contracts that expire in August.',
    'Pocket Nurse offering clinical rotation kits at $380/kit vs our $480. Volume is 60 kits — $6K difference. Need to compete on quality.',
    null,
    null,
    null,
  ],
  'James Thornton': [
    null,
    'Laerdal direct rep offered 18-month payment terms vs our standard net-30. Working with finance to match.',
    null,
    null,
    null,
    null,
    null,
    'Local distributor (Northeast Medical Supply) has established relationships here. They can not match our simulation expertise but have faster delivery for commodities.',
  ],
  'Maria Gonzalez': [
    null,
    null,
    null,
    null,
    null,
    null,
    'Pocket Nurse submitted aggressive bid. Differentiating on service contract — our 4-hour response SLA vs their next-business-day.',
    null,
  ],
  'David Kim': [null, null, null, null, null, null, null],
  'Lisa Chen': [
    null,
    'Currently buying from Pocket Nurse. Dissatisfied with quality of task trainers — several broke within first semester. Opportunity to displace.',
    'State contract vendor (Nasco Healthcare) has preferential pricing through their GPO. Need to get on the state contract list.',
    null,
    null,
    'They use Laerdal manikins exclusively. Training center director mentioned Laerdal support has been slow lately. Possible opening.',
    null,
    null,
    null,
    null,
    null,
  ],
}

function generateProfileCalls(): SeedProfileCall[] {
  const rand = seededRandom(7777)
  const calls: SeedProfileCall[] = []

  interface RepConfig {
    repId: string
    repName: string
    callCount: number
    outcomes: ProfileCallOutcome[]
    types: ProfileCallType[]
    durationMin: number
    durationMax: number
    conversionRate: number
    accountPool: string[]
    productBias: string[]
    programSizeBias: string[]
  }

  const repConfigs: RepConfig[] = [
    {
      repId: 'REP-001', repName: 'Sarah Mitchell', callCount: 26, conversionRate: 0.40,
      outcomes: ['Interested - Next Steps', 'Interested - Next Steps', 'Interested - Next Steps', 'Quote Requested', 'Quote Requested', 'Scheduled Demo', 'Scheduled Demo', 'Needs Follow-Up', 'Needs Follow-Up', 'Not Interested', 'No Answer'],
      types: ['Follow-Up', 'Follow-Up', 'Product Demo', 'Product Demo', 'Budget Discussion', 'Budget Discussion', 'Needs Assessment', 'Contract Review', 'Initial Discovery'],
      durationMin: 20, durationMax: 45,
      accountPool: ['Rush University College of Nursing', 'University of Illinois Chicago College of Nursing', 'Loyola University Chicago Marcella Niehoff School of Nursing', 'University of Michigan School of Nursing', 'Case Western Reserve Frances Payne Bolton School of Nursing', 'Northwestern Memorial Hospital Education', 'Advocate Aurora Health Training Center', 'Mayo Clinic Simulation Center', 'Cleveland Clinic Education Institute', 'College of DuPage Nursing Program', 'Harper College Nursing Program', 'Moraine Valley Community College'],
      productBias: ['Pyxis MedStation', 'Simulation Manikins', 'Hospital Beds', 'Vital Signs Monitors'],
      programSizeBias: ['Large (150-500 students)', 'Enterprise (500+ students)', 'Large (150-500 students)', 'Medium (50-150 students)'],
    },
    {
      repId: 'REP-002', repName: 'James Thornton', callCount: 15, conversionRate: 0.25,
      outcomes: ['Interested - Next Steps', 'Needs Follow-Up', 'Needs Follow-Up', 'Scheduled Demo', 'Not Interested', 'Left Voicemail', 'Quote Requested'],
      types: ['Initial Discovery', 'Follow-Up', 'Follow-Up', 'Product Demo', 'Needs Assessment', 'Budget Discussion', 'Contract Review'],
      durationMin: 15, durationMax: 30,
      accountPool: ['NYU Rory Meyers College of Nursing', 'Johns Hopkins School of Nursing', 'University of Pennsylvania School of Nursing', 'Columbia University School of Nursing', 'University of Pittsburgh School of Nursing', 'Massachusetts General Hospital Sim Center'],
      productBias: ['Simulation Manikins', 'Hospital Beds', 'Skills Lab Kits', 'Consumables'],
      programSizeBias: ['Large (150-500 students)', 'Medium (50-150 students)', 'Enterprise (500+ students)'],
    },
    {
      repId: 'REP-003', repName: 'Maria Gonzalez', callCount: 14, conversionRate: 0.25,
      outcomes: ['Interested - Next Steps', 'Needs Follow-Up', 'Needs Follow-Up', 'Scheduled Demo', 'Not Interested', 'No Answer', 'Quote Requested'],
      types: ['Initial Discovery', 'Follow-Up', 'Follow-Up', 'Product Demo', 'Needs Assessment', 'Budget Discussion', 'Contract Review'],
      durationMin: 15, durationMax: 30,
      accountPool: ['Emory University Nell Hodgson Woodruff School of Nursing', 'Duke University School of Nursing', 'Vanderbilt University School of Nursing', 'Miami Dade College Nursing', 'ECPI University Nursing'],
      productBias: ['Simulation Manikins', 'Skills Lab Kits', 'IV Trainers', 'Consumables'],
      programSizeBias: ['Medium (50-150 students)', 'Large (150-500 students)', 'Small (<50 students)'],
    },
    {
      repId: 'REP-004', repName: 'David Kim', callCount: 7, conversionRate: 0.14,
      outcomes: ['No Answer', 'No Answer', 'Left Voicemail', 'Left Voicemail', 'Not Interested', 'Needs Follow-Up', 'Interested - Next Steps'],
      types: ['Initial Discovery', 'Initial Discovery', 'Follow-Up', 'Follow-Up', 'Needs Assessment'],
      durationMin: 5, durationMax: 15,
      accountPool: ['UCLA School of Nursing', 'University of Washington School of Nursing', 'Cleveland Clinic Education Institute'],
      productBias: ['Hospital Beds', 'Pyxis MedStation', 'Consumables'],
      programSizeBias: ['Medium (50-150 students)', 'Large (150-500 students)'],
    },
    {
      repId: 'REP-005', repName: 'Lisa Chen', callCount: 11, conversionRate: 0.18,
      outcomes: ['Interested - Next Steps', 'Interested - Next Steps', 'Needs Follow-Up', 'Needs Follow-Up', 'Needs Follow-Up', 'Scheduled Demo', 'No Answer'],
      types: ['Initial Discovery', 'Initial Discovery', 'Initial Discovery', 'Needs Assessment', 'Needs Assessment', 'Follow-Up', 'Budget Discussion'],
      durationMin: 15, durationMax: 30,
      accountPool: ['Houston Community College Nursing', 'Chamberlain University College of Nursing', 'Herzing University Nursing Program', 'Rasmussen University School of Nursing'],
      productBias: ['Skills Lab Kits', 'IV Trainers', 'Consumables', 'Simulation Manikins'],
      programSizeBias: ['Small (<50 students)', 'Medium (50-150 students)', 'Medium (50-150 students)'],
    },
  ]

  // Generate dates spread across Jan 1 - Mar 31, 2026
  const startDate = new Date('2026-01-05')
  const endDate = new Date('2026-03-31')
  const totalDays = Math.floor((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24))

  let callId = 1

  for (const config of repConfigs) {
    const notes = profileCallNotes[config.repName]
    const intel = profileCallCompetitorIntel[config.repName]

    for (let i = 0; i < config.callCount; i++) {
      const dayOffset = Math.floor(rand() * totalDays)
      const date = new Date(startDate.getTime() + dayOffset * 24 * 60 * 60 * 1000)
      // Skip weekends
      if (date.getDay() === 0) date.setDate(date.getDate() + 1)
      if (date.getDay() === 6) date.setDate(date.getDate() + 2)
      const dateStr = date.toISOString().split('T')[0]

      const outcome = pick(config.outcomes, rand)
      const callType = pick(config.types, rand)
      const account = pick(config.accountPool, rand)
      const contact = pick(profileCallContacts, rand)
      const duration = randomInt(config.durationMin, config.durationMax, rand)
      const isConverted = rand() < config.conversionRate
      const numProducts = outcome === 'No Answer' || outcome === 'Left Voicemail' ? 0 : randomInt(1, 3, rand)
      const products = numProducts > 0 ? pickN([...config.productBias, ...profileCallProducts], numProducts, rand) : []
      const size = pick(config.programSizeBias, rand)
      const hasBudget = outcome !== 'No Answer' && outcome !== 'Left Voicemail' && outcome !== 'Not Interested' && rand() > 0.4
      const budget = hasBudget ? randomInt(15, 250, rand) * 1000 : null
      const timeframe = hasBudget ? pick(budgetTimeframes, rand) : null
      const hasFollowUp = outcome !== 'Not Interested' && outcome !== 'No Answer'
      const followUpDate = hasFollowUp ? new Date(date.getTime() + randomInt(3, 14, rand) * 24 * 60 * 60 * 1000).toISOString().split('T')[0] : null
      const supplier = rand() > 0.5 ? pick(competitors, rand) : null
      const noteIdx = i % notes.length
      const intelEntry = i < intel.length ? intel[i] : null

      calls.push({
        id: `PC-${String(callId++).padStart(3, '0')}`,
        subject: `Profile Call — ${account}`,
        repId: config.repId,
        repName: config.repName,
        accountName: account,
        contactName: contact,
        activityDate: dateStr,
        callType,
        callOutcome: outcome,
        productsDiscussed: products,
        programSize: size,
        currentSupplier: supplier,
        budgetAvailable: budget,
        budgetTimeframe: timeframe,
        followUpDate,
        convertedToOpp: isConverted,
        relatedOpportunityName: isConverted ? `${account} — ${pick(['SimLab Expansion', 'Equipment Refresh', 'Capital Purchase', 'Skills Lab Build-Out', 'Annual Supply Order', 'Simulation Upgrade'], rand)}` : null,
        callDurationMinutes: outcome === 'No Answer' ? 0 : outcome === 'Left Voicemail' ? randomInt(1, 3, rand) : duration,
        callNotesSummary: notes[noteIdx],
        competitorIntel: intelEntry,
      })
    }
  }

  return calls.sort((a, b) => b.activityDate.localeCompare(a.activityDate))
}

export const seedProfileCalls = generateProfileCalls()

// =============================================================================
// 18. Weekly Call Volume (last 8 weeks)
// =============================================================================

export const seedWeeklyCallVolume: SeedWeeklyCallVolume[] = [
  { weekStart: '2026-02-02', 'Sarah Mitchell': 3, 'James Thornton': 1, 'Maria Gonzalez': 2, 'David Kim': 2, 'Lisa Chen': 0 },
  { weekStart: '2026-02-09', 'Sarah Mitchell': 3, 'James Thornton': 2, 'Maria Gonzalez': 1, 'David Kim': 1, 'Lisa Chen': 0 },
  { weekStart: '2026-02-16', 'Sarah Mitchell': 3, 'James Thornton': 2, 'Maria Gonzalez': 2, 'David Kim': 1, 'Lisa Chen': 0 },
  { weekStart: '2026-02-23', 'Sarah Mitchell': 4, 'James Thornton': 2, 'Maria Gonzalez': 1, 'David Kim': 1, 'Lisa Chen': 1 },
  { weekStart: '2026-03-02', 'Sarah Mitchell': 3, 'James Thornton': 2, 'Maria Gonzalez': 2, 'David Kim': 0, 'Lisa Chen': 2 },
  { weekStart: '2026-03-09', 'Sarah Mitchell': 3, 'James Thornton': 2, 'Maria Gonzalez': 2, 'David Kim': 1, 'Lisa Chen': 2 },
  { weekStart: '2026-03-16', 'Sarah Mitchell': 4, 'James Thornton': 2, 'Maria Gonzalez': 2, 'David Kim': 1, 'Lisa Chen': 3 },
  { weekStart: '2026-03-23', 'Sarah Mitchell': 4, 'James Thornton': 3, 'Maria Gonzalez': 2, 'David Kim': 0, 'Lisa Chen': 3 },
]
