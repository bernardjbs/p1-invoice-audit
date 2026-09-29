import { useRef, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useUploadInvoice, useVendors } from './api'
import { SampleInvoices, type Sample } from './sample-invoices'

/**
 * Upload an invoice PDF + minimal fields (plan T11). On success we jump to the
 * detail view, which polls while the audit runs so the results appear live.
 * Native form + FormData (the API re-validates with Zod at the boundary).
 */
export function UploadPage() {
  const navigate = useNavigate()
  const { data: vendors } = useVendors()
  const upload = useUploadInvoice()
  const [vendorId, setVendorId] = useState('')
  const [sampleError, setSampleError] = useState<string | null>(null)
  const formRef = useRef<HTMLFormElement>(null)

  /**
   * Load a sample into the form: fill the fields, then fetch its PDF and put it
   * on the file input so the visitor only has to press Upload. A file input
   * cannot be assigned a path, but it can be assigned a `FileList`, which is
   * what `DataTransfer` exists to build.
   */
  const useSample = async (sample: Sample) => {
    const form = formRef.current
    if (!form) return

    const vendor = (vendors ?? []).find((v) => v.name === sample.vendorName)
    // The samples are billed by a seeded vendor. If the database has not been
    // seeded, say so rather than uploading against the wrong one.
    if (!vendor) {
      setSampleError(`${sample.vendorName} is not in the vendor list — is the database seeded?`)
      return
    }
    setSampleError(null)
    setVendorId(vendor.id)

    const fields: Record<string, string> = {
      invoiceNumber: sample.invoiceNumber,
      subtotalAud: String(sample.subtotalAud),
      gstAud: String(sample.gstAud),
      totalAud: String(sample.totalAud),
    }
    for (const [name, value] of Object.entries(fields)) {
      const input = form.elements.namedItem(name)
      if (input instanceof HTMLInputElement) input.value = value
    }

    try {
      const res = await fetch(`/samples/${sample.file}`)
      if (!res.ok) throw new Error(`the sample PDF returned ${res.status}`)
      const file = new File([await res.blob()], sample.file, { type: 'application/pdf' })
      const pdfInput = form.elements.namedItem('pdf')
      if (pdfInput instanceof HTMLInputElement) {
        const dt = new DataTransfer()
        dt.items.add(file)
        pdfInput.files = dt.files
      }
    } catch (e) {
      setSampleError(`Could not attach the sample PDF: ${(e as Error).message}`)
    }
  }

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    form.set('vendorId', vendorId)
    upload.mutate(form, {
      onSuccess: ({ id }) => navigate({ to: '/invoices/$id', params: { id } }),
    })
  }

  return (
    <div className="max-w-2xl space-y-6">
      <h1 className="text-2xl font-semibold">Upload invoice</h1>

      <SampleInvoices onUse={useSample} />
      {sampleError && <p className="text-destructive text-sm">{sampleError}</p>}

      <form ref={formRef} onSubmit={onSubmit} className="space-y-4">
        <div className="space-y-1">
          <Label htmlFor="invoiceNumber">Invoice number</Label>
          <Input id="invoiceNumber" name="invoiceNumber" required />
        </div>

        <div className="space-y-1">
          <Label>Vendor</Label>
          <Select value={vendorId} onValueChange={setVendorId} required>
            <SelectTrigger>
              <SelectValue placeholder="Select a vendor" />
            </SelectTrigger>
            <SelectContent>
              {(vendors ?? []).map((v) => (
                <SelectItem key={v.id} value={v.id}>
                  {v.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <Field id="subtotalAud" label="Subtotal" />
          <Field id="gstAud" label="GST" />
          <Field id="totalAud" label="Total" />
        </div>

        <div className="space-y-1">
          <Label htmlFor="pdf">Invoice PDF</Label>
          <Input id="pdf" name="pdf" type="file" accept="application/pdf" required />
        </div>

        {upload.isError && (
          <p className="text-destructive text-sm">Upload failed: {upload.error.message}</p>
        )}

        <div className="flex items-center gap-3">
          <Button type="submit" disabled={upload.isPending || !vendorId}>
            {upload.isPending ? 'Uploading…' : 'Upload & audit'}
          </Button>
          {!vendorId && !upload.isPending && (
            <p className="text-muted-foreground text-sm">Choose a vendor to continue.</p>
          )}
        </div>
      </form>
    </div>
  )
}

function Field({ id, label }: { id: string; label: string }) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id}>{label} (AUD)</Label>
      <Input id={id} name={id} type="number" step="0.01" min="0" required />
    </div>
  )
}
