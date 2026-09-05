/**
 * Synthetic MSA corpus + ground truth.
 * Plan: 2026-09-04-p1-phase-b-langgraph-engine, task T3.
 *
 * Phase A stored a contract's NUMBERS (the rate card). The contract-terms check
 * reads a contract's WORDS, so this generates the words: one Master Services
 * Agreement per contracted vendor, as markdown, committed as fixtures.
 *
 * Every clause here is fabricated. The point is that some of them are
 * deliberately BREAKABLE by the dirty invoices the seed already creates, so the
 * agent has real work rather than a corpus where everything passes.
 *
 * Pure and deterministic: no randomness, no clock, no ids. Same input, byte-
 * identical output — which is what lets the generated files be committed and
 * diffed rather than regenerated blind.
 */

/** A vendor that holds a contract, in seed order. Indices match `VENDOR_DEFS`. */
export type ContractVendor = {
  vendorIndex: number
  name: string
  msaRef: string
  /** Days from invoice date to due date. */
  paymentDays: number
  /** Maximum % a rate may exceed the agreed rate card before it needs a variation. */
  rateVariationCapPct: number
}

export const CONTRACT_VENDORS: ContractVendor[] = [
  { vendorIndex: 0, name: 'Pilbara Pumps Pty Ltd', msaRef: 'MSA-1000', paymentDays: 30, rateVariationCapPct: 5 },
  { vendorIndex: 1, name: 'Kalgoorlie Valves & Fittings Pty Ltd', msaRef: 'MSA-1001', paymentDays: 30, rateVariationCapPct: 5 },
  { vendorIndex: 2, name: 'Hedland Heavy Haulage Pty Ltd', msaRef: 'MSA-1002', paymentDays: 45, rateVariationCapPct: 7.5 },
  { vendorIndex: 3, name: 'Goldfields Fasteners Pty Ltd', msaRef: 'MSA-1003', paymentDays: 30, rateVariationCapPct: 5 },
]

/** `Pilbara Pumps Pty Ltd` → `pilbara-pumps-pty-ltd`. Stable filenames. */
export function vendorSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

export type Clause = {
  /** Section number within the MSA, e.g. 4 → "§4". */
  section: number
  heading: string
  text: string
}

/**
 * The eight clauses every MSA carries. Five are the plan's named subjects
 * (payment terms, GST, weekend surcharge, PO required, rate variation); three
 * more exist so the corpus clears the ≥30-chunk gate with only four contracted
 * vendors — 4 × 8 = 32.
 */
export function clausesFor(vendor: ContractVendor): Clause[] {
  return [
    {
      section: 1,
      heading: 'Term and Scope',
      text:
        `This Master Services Agreement (${vendor.msaRef}) governs all goods and services supplied ` +
        `by ${vendor.name} ("the Supplier") to the Principal. It commences on 1 July 2025 and ` +
        `continues until 30 June 2027 unless terminated earlier in accordance with clause 8.`,
    },
    {
      section: 2,
      heading: 'Payment Terms',
      text:
        `The Principal shall pay each correctly rendered tax invoice within ${vendor.paymentDays} ` +
        `days of the invoice date. An invoice is correctly rendered only if it states the purchase ` +
        `order number, the Supplier's ABN, and a separate line for GST.`,
    },
    {
      section: 3,
      heading: 'Goods and Services Tax',
      text:
        'All prices are exclusive of GST. GST shall be shown as a separate amount equal to ten per ' +
        'cent (10%) of the invoice subtotal. The invoice total must equal the subtotal plus GST, and ' +
        'the subtotal must equal the sum of all line items.',
    },
    {
      section: 4,
      heading: 'Purchase Orders Required',
      text:
        'No goods or services shall be supplied except against a valid purchase order issued by the ' +
        'Principal before supply. The invoiced total must not exceed the total of the purchase order ' +
        'against which it is rendered. Work performed without a purchase order is not payable.',
    },
    {
      section: 5,
      heading: 'Rates and Variations',
      text:
        `Rates are those set out in the agreed rate card and are fixed for the term. The Supplier ` +
        `shall not invoice any item at a rate exceeding the agreed rate by more than ` +
        `${vendor.rateVariationCapPct}% without a written variation signed by both parties. Any ` +
        `amount invoiced above that threshold is not payable.`,
    },
    {
      section: 6,
      heading: 'Hours of Work and Surcharges',
      text:
        'Standard hours are 6:00am to 6:00pm Monday to Friday. No surcharge, loading, penalty or ' +
        'call-out fee shall apply in respect of works performed outside standard hours, including ' +
        'weekends and public holidays, unless expressly approved in writing in advance.',
    },
    {
      section: 7,
      heading: 'Insurance and Compliance',
      text:
        'The Supplier shall maintain public liability insurance of not less than $20,000,000 and ' +
        'workers compensation insurance as required by law, and shall provide certificates of ' +
        'currency on request.',
    },
    {
      section: 8,
      heading: 'Termination',
      text:
        'Either party may terminate this agreement for convenience on sixty (60) days written ' +
        'notice, or immediately for material breach that remains unremedied fourteen (14) days ' +
        'after written notice of the breach.',
    },
  ]
}

/** The citation string stored on every chunk and shown to the user. */
export function sourceRefFor(vendor: ContractVendor, clause: Clause): string {
  return `${vendor.msaRef} §${clause.section}`
}

/** Render one vendor's MSA as markdown. Deterministic. */
export function renderMsa(vendor: ContractVendor): string {
  const lines: string[] = [
    `# Master Services Agreement — ${vendor.name}`,
    '',
    `**Agreement reference:** ${vendor.msaRef}  `,
    `**Supplier:** ${vendor.name}  `,
    `**Principal:** Northwest Resources Operations Pty Ltd  `,
    `**Commencement:** 1 July 2025  `,
    `**Expiry:** 30 June 2027`,
    '',
    '> Synthetic document. Fabricated parties and terms, generated for testing an',
    '> invoice-audit system. Not a real agreement.',
    '',
  ]
  for (const clause of clausesFor(vendor)) {
    lines.push(`## ${clause.section}. ${clause.heading}`, '', clause.text, '')
  }
  return lines.join('\n')
}

// --- Ground truth -----------------------------------------------------------

/**
 * A clause a seeded invoice actually breaches, and why. This is the answer key
 * the contract-terms evaluation scores against: because the data is synthetic we
 * KNOW the right answer, which is what makes an eval possible at all.
 */
export type PlantedViolation = {
  invoiceNumber: string
  msaRef: string
  sourceRef: string
  clauseSection: number
  /** Plain-language statement of what the invoice did that the clause forbids. */
  breach: string
}

/**
 * The dirty invoices the seed creates, mapped to the clause each one breaches.
 * Invoice numbers follow the seed's ordering: fifteen clean invoices
 * (INV-0001…INV-0015) then five deliberate discrepancies.
 */
export const PLANTED_VIOLATIONS: PlantedViolation[] = [
  {
    invoiceNumber: 'INV-0016',
    msaRef: 'MSA-1000',
    sourceRef: 'MSA-1000 §5',
    clauseSection: 5,
    breach: 'Pump billed 20% above the agreed rate card, exceeding the 5% variation cap.',
  },
  {
    invoiceNumber: 'INV-0017',
    msaRef: 'MSA-1001',
    sourceRef: 'MSA-1001 §5',
    clauseSection: 5,
    breach: 'Valves billed 10% above the agreed rate card, exceeding the 5% variation cap.',
  },
  {
    invoiceNumber: 'INV-0018',
    msaRef: 'MSA-1002',
    sourceRef: 'MSA-1002 §3',
    clauseSection: 3,
    breach: 'Stated subtotal does not equal the sum of the line items.',
  },
  {
    invoiceNumber: 'INV-0019',
    msaRef: 'MSA-1003',
    sourceRef: 'MSA-1003 §4',
    clauseSection: 4,
    breach: 'Invoice total does not match the purchase order it was rendered against.',
  },
]

export type GroundTruth = {
  note: string
  vendors: {
    vendorIndex: number
    name: string
    msaRef: string
    slug: string
    clauses: { sourceRef: string; section: number; heading: string; text: string }[]
  }[]
  violations: PlantedViolation[]
}

export function buildGroundTruth(): GroundTruth {
  return {
    note:
      'Answer key for the synthetic contract corpus. Generated — do not hand-edit; ' +
      'regenerate with `bun run contracts:generate`.',
    vendors: CONTRACT_VENDORS.map((vendor) => ({
      vendorIndex: vendor.vendorIndex,
      name: vendor.name,
      msaRef: vendor.msaRef,
      slug: vendorSlug(vendor.name),
      clauses: clausesFor(vendor).map((clause) => ({
        sourceRef: sourceRefFor(vendor, clause),
        section: clause.section,
        heading: clause.heading,
        text: clause.text,
      })),
    })),
    violations: PLANTED_VIOLATIONS,
  }
}

// --- Chunking ---------------------------------------------------------------

export type ContractChunk = {
  msaRef: string
  sourceRef: string
  content: string
}

/**
 * Longest clause we store as a single chunk. Clause sections are the natural
 * unit here — an obligation and its exception belong together, and splitting
 * them is how a retriever ends up citing the obligation without its carve-out.
 * The limit only exists so one pathologically long clause cannot dominate the
 * context window.
 */
export const MAX_CHUNK_CHARS = 1200

/**
 * Split a clause that exceeds the limit on sentence boundaries, never mid-word,
 * and never dropping text. Parts after the first carry a suffixed citation
 * (`§5 (cont. 2)`) so a citation always resolves to something a human can find.
 */
export function chunkClause(vendor: ContractVendor, clause: Clause): ContractChunk[] {
  const baseRef = sourceRefFor(vendor, clause)
  const body = `${clause.section}. ${clause.heading} — ${clause.text}`
  if (body.length <= MAX_CHUNK_CHARS) {
    return [{ msaRef: vendor.msaRef, sourceRef: baseRef, content: body }]
  }

  const sentences = body.split(/(?<=\.)\s+/)
  const parts: string[] = []
  let current = ''
  for (const sentence of sentences) {
    if (current !== '' && `${current} ${sentence}`.length > MAX_CHUNK_CHARS) {
      parts.push(current)
      current = sentence
    } else {
      current = current === '' ? sentence : `${current} ${sentence}`
    }
  }
  if (current !== '') parts.push(current)

  return parts.map((content, i) => ({
    msaRef: vendor.msaRef,
    sourceRef: i === 0 ? baseRef : `${baseRef} (cont. ${i + 1})`,
    content,
  }))
}

/** Every chunk for one vendor's MSA, in section order. */
export function chunksFor(vendor: ContractVendor): ContractChunk[] {
  return clausesFor(vendor).flatMap((clause) => chunkClause(vendor, clause))
}
