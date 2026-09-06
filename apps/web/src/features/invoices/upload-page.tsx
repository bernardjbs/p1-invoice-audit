import { useState } from 'react'
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

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    form.set('vendorId', vendorId)
    upload.mutate(form, {
      onSuccess: ({ id }) => navigate({ to: '/invoices/$id', params: { id } }),
    })
  }

  return (
    <div className="max-w-lg space-y-6">
      <h1 className="text-2xl font-semibold">Upload invoice</h1>
      <form onSubmit={onSubmit} className="space-y-4">
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

        <Button type="submit" disabled={upload.isPending || !vendorId}>
          {upload.isPending ? 'Uploading…' : 'Upload & audit'}
        </Button>
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
