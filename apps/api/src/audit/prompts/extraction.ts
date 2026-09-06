/**
 * The invoice-extraction prompt. Prompts are DATA, not code (CONVENTIONS §10):
 * this file holds strings and nothing else, so a prompt change is reviewable as
 * a diff and cannot quietly carry logic with it.
 *
 * The hardening against invoice text that reads as instructions (an attacker
 * controls the line descriptions) lands in the prompt-injection task, and lands
 * HERE — which is the reason the prompt is a file from the first commit rather
 * than a string inside the extractor.
 */

/**
 * Asks for JSON only. The reply is parsed and validated regardless (see
 * extraction.ts), so this is an efficiency measure, not a safety one: a model
 * that answers in prose costs a retry, it does not corrupt data.
 *
 * The AUD note is load-bearing. Every amount is printed as formatted currency
 * (`$6,000.00`) by the PDF renderer, and without the instruction a model may
 * hand back the string it saw rather than the number it means.
 */
export const EXTRACTION_PROMPT = `You are reading a single Australian tax invoice.

Return ONLY a JSON object, with no commentary and no code fence, in exactly this shape:

{
  "invoiceNumber": string,
  "abn": string,
  "subtotalAud": number,
  "gstAud": number,
  "totalAud": number,
  "lines": [
    {
      "itemCode": string,
      "description": string,
      "qty": number,
      "unitPriceAud": number,
      "lineTotalAud": number
    }
  ]
}

Rules:
- Every amount is a plain number in AUD: strip the currency symbol, thousands separators and any trailing text. Write 6000, never "$6,000.00".
- "abn" is the digits of the ABN only, with spaces removed.
- Include one entry in "lines" for every row of the line-item table, in the order printed.
- Copy "itemCode" and "description" exactly as printed. Do not tidy, expand or translate them.
- Report what the document says, even if the arithmetic looks wrong. Do not correct it.`
