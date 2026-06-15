import { normalizeNumber, isValidE164 } from './calling';

export type ParsedContact = { name: string; phone: string };

// Parse a vCard (.vcf, what phones export) or simple CSV (name,phone) into a
// clean, deduped list of E.164 contacts. Anything unparseable is skipped.
export function parseContacts(text: string, filename: string): ParsedContact[] {
  const lower = filename.toLowerCase();
  const raw: ParsedContact[] = [];

  if (lower.endsWith('.vcf') || /BEGIN:VCARD/i.test(text)) {
    for (const card of text.split(/BEGIN:VCARD/i).slice(1)) {
      const fn = /\r?\nFN[^:\r\n]*:(.+)/i.exec(card)?.[1]?.trim();
      const tel = /\r?\nTEL[^:\r\n]*:(.+)/i.exec(card)?.[1]?.trim();
      if (tel) raw.push({ name: fn || tel, phone: tel });
    }
  } else {
    // CSV: "name,phone" per line. Skip an obvious header row.
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const parts = trimmed.split(',');
      if (parts.length < 2) continue;
      const name = parts[0].trim().replace(/^"|"$/g, '');
      const phone = parts.slice(1).join(',').trim().replace(/^"|"$/g, '');
      if (/^name$/i.test(name) && /phone|number|tel/i.test(phone)) continue;
      raw.push({ name, phone });
    }
  }

  const seen = new Set<string>();
  const out: ParsedContact[] = [];
  for (const c of raw) {
    const phone = normalizeNumber(c.phone);
    if (!isValidE164(phone) || seen.has(phone)) continue;
    seen.add(phone);
    out.push({ name: c.name?.trim() || phone, phone });
  }
  return out;
}
