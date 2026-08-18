import { api } from '../../lib/api.js';
import { Field, Input, TextArea, Select } from '../ui.jsx';

// Website/Vertical/HQ/Headcount + Description — shared by the company
// profile and the deal panel's Company Intel section. `children` is a slot
// for page-specific extra fields appended to the same grid (the company
// profile uses it for the two Everflow fields; the deal panel passes none).
export default function FirmographicsFields({ lead, verticals, after, children }) {
  return (
    <>
      {/* Keyed by enriched_at so Apollo-filled values replace the
          uncontrolled inputs' DOM value after an enrichment refresh. */}
      <div key={`hdr-${lead.enriched_at ?? '0'}`} className="grid grid-cols-2 gap-3 mt-4">
        <Field label="Website">
          <Input
            defaultValue={lead.website ?? ''}
            onBlur={(e) => after(() => api.updateLead(lead.id, { website: e.target.value }))}
            placeholder="acme.com"
          />
        </Field>
        <Field label="Vertical">
          <Select
            value={lead.vertical_id ?? ''}
            onChange={(e) =>
              after(() =>
                api.updateLead(lead.id, { vertical_id: e.target.value ? Number(e.target.value) : null }),
              )
            }
          >
            <option value="">Unsorted</option>
            {verticals.map((v) => (
              <option key={v.id} value={v.id}>{v.name}</option>
            ))}
          </Select>
        </Field>
        <Field label="HQ / Location">
          <Input
            defaultValue={lead.hq_location ?? ''}
            onBlur={(e) => after(() => api.updateLead(lead.id, { hq_location: e.target.value }))}
            placeholder="San Francisco, CA"
          />
        </Field>
        <Field label="Employees / Size">
          <Input
            defaultValue={lead.headcount ?? ''}
            onBlur={(e) => after(() => api.updateLead(lead.id, { headcount: e.target.value }))}
            placeholder="51-200"
          />
        </Field>
        {children}
      </div>

      <div className="mt-3" key={`desc-${lead.enriched_at ?? '0'}`}>
        <Field label="Description">
          <TextArea
            defaultValue={lead.description ?? ''}
            onBlur={(e) => after(() => api.updateLead(lead.id, { description: e.target.value }))}
            placeholder="What the company does, context, fit…"
          />
        </Field>
      </div>
    </>
  );
}
