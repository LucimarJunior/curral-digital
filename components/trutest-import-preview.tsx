'use client'

import React from 'react'
import { parseTruTestCsv, type TruTestRow, type TruTestParseResult } from '@/lib/trutest-import'
import { supabase } from '@/lib/supabase'

type ExistingAnimal = { id: string; electronic_id: string | null; tag_number: string; pasture: string | null }
type PreviewRow = TruTestRow & { existing: ExistingAnimal | null }

interface Props {
  farmId: string | null
  pastures: { id: string; name: string }[]
}

export default function TruTestImportPreview({ farmId, pastures }: Props) {
  const [fileName, setFileName] = React.useState('')
  const [parsed, setParsed] = React.useState<TruTestParseResult | null>(null)
  const [preview, setPreview] = React.useState<PreviewRow[]>([])
  const [loading, setLoading] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [saveResult, setSaveResult] = React.useState('')
  const [error, setError] = React.useState('')
  const [sex, setSex] = React.useState('Male')
  const [breed, setBreed] = React.useState('Nelore')
  const [category, setCategory] = React.useState('Bezerro')
  const [pasture, setPasture] = React.useState('')

  async function onFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setFileName(file.name)
    setSaveResult('')
    setParsed(null)
    setPreview([])
    setError('')
    if (!farmId) {
      setError('Selecione uma fazenda antes de importar.')
      return
    }
    if (!file.name.toLowerCase().endsWith('.csv')) {
      setError('A importação Tru-Test aceita o arquivo CSV original.')
      return
    }
    setLoading(true)
    try {
      const result = parseTruTestCsv(await file.text())
      setParsed(result)
      if (result.errors.length) {
        setError('Corrija os erros do arquivo antes de continuar. Nenhum dado foi gravado.')
        return
      }
      if (!result.rows.length) {
        setError('O arquivo não contém pesagens válidas.')
        return
      }

      // Consultas em lotes para evitar limites de URL e o limite padrão de linhas.
      const existingByIde = new Map<string, ExistingAnimal>()
      const ids = [...new Set(result.rows.map(row => row.electronicId))]
      for (let i = 0; i < ids.length; i += 100) {
        const { data, error: queryError } = await supabase
          .from('cattle')
          .select('id,electronic_id,tag_number,pasture')
          .eq('farm_id', farmId)
          .in('electronic_id', ids.slice(i, i + 100))
        if (queryError) throw queryError
        for (const animal of (data ?? []) as ExistingAnimal[]) {
          if (animal.electronic_id) existingByIde.set(animal.electronic_id.replace(/\s+/g, ''), animal)
        }
      }
      setPreview(result.rows.map(row => ({ ...row, existing: existingByIde.get(row.electronicId) ?? null })))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível ler o arquivo.')
    } finally {
      setLoading(false)
    }
  }

  async function confirmImport() {
    if (!farmId || !preview.length || !pasture.trim() || !breed.trim() || !category.trim()) {
      setError('Selecione um pasto e informe raça e categoria.')
      return
    }
    if (!window.confirm(`Confirmar a importação de ${preview.length} pesagens da Tru-Test? Esta ação gravará dados no rebanho.`)) return
    setSaving(true)
    setError('')
    setSaveResult('')
    try {
      // A função no banco faz toda a operação em uma transação, com validação de proprietário.
      const payload = preview.map(row => ({
        electronic_id: row.electronicId,
        tag_number: row.visualId,
        weight_kg: row.weightKg,
        weighing_date: row.weighingDate,
        weighing_time: row.weighingTime,
        gmd: row.gmd,
        gpv: row.gpv,
        classification: row.classification,
      }))
      const { data, error: rpcError } = await supabase.rpc('import_trutest_batch' as never, {
        p_farm_id: farmId,
        p_rows: payload,
        p_gender: sex,
        p_breed: breed.trim(),
        p_category: category.trim(),
        p_pasture: pasture,
      } as never)
      if (rpcError) throw rpcError
      const result = data as { new_animals: number; existing_animals: number; skipped_weighings: number }
      setSaveResult(`Importação concluída: ${result.new_animals} novos, ${result.existing_animals} já cadastrados, ${result.skipped_weighings} pesagens repetidas ignoradas.`)
      setPreview([])
      setParsed(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha na importação. Nenhuma alteração deve ser considerada concluída.')
    } finally {
      setSaving(false)
    }
  }

  const existingCount = preview.filter(row => row.existing).length
  const newCount = preview.length - existingCount

  return (
    <section className="space-y-5 rounded-2xl border border-outline-variant bg-surface-container-lowest p-6">
      <div>
        <h3 className="text-xl font-bold text-on-surface">Prévia da importação Tru-Test</h3>
        <p className="text-sm text-outline">Leia o CSV original, confira os animais e complemente os dados do lote antes de confirmar a gravação.</p>
      </div>
      <label className="block cursor-pointer rounded-xl border-2 border-dashed border-outline-variant p-6 text-center font-semibold">
        {loading ? 'Conferindo animais cadastrados...' : 'Selecionar arquivo CSV da Tru-Test'}
        <input type="file" accept=".csv,text/csv" onChange={onFileChange} disabled={loading} className="sr-only" />
      </label>
      {fileName && <p className="text-sm text-outline">Arquivo: {fileName}</p>}
      {saveResult && <p role="status" className="rounded-lg bg-green-50 p-3 text-sm font-semibold text-green-800">{saveResult}</p>}
      {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>}
      {parsed && (
        <div className="space-y-2">
          <p className="text-sm font-semibold">Linhas lidas: {parsed.totalDataRows} · Válidas: {parsed.rows.length}</p>
          {parsed.errors.length > 0 && <ul className="max-h-40 overflow-auto rounded-lg bg-red-50 p-3 text-sm text-red-800">{parsed.errors.map((msg, i) => <li key={i}>{msg}</li>)}</ul>}
          {parsed.warnings.length > 0 && <details className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900"><summary className="cursor-pointer font-semibold">{parsed.warnings.length} aviso(s)</summary><ul className="mt-2 max-h-40 overflow-auto">{parsed.warnings.map((msg, i) => <li key={i}>{msg}</li>)}</ul></details>}
        </div>
      )}
      {preview.length > 0 && (
        <>
          <div className="grid grid-cols-2 gap-3 text-center">
            <div className="rounded-xl bg-surface-container-low p-4"><p className="text-3xl font-bold">{newCount}</p><p className="text-sm">Animais novos</p></div>
            <div className="rounded-xl bg-surface-container-low p-4"><p className="text-3xl font-bold">{existingCount}</p><p className="text-sm">Já cadastrados</p></div>
          </div>
          <div className="space-y-3">
            <p className="font-bold">Informações para animais novos</p>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <label className="text-sm">Sexo
                <select value={sex} onChange={e => setSex(e.target.value)} className="mt-1 w-full rounded-lg border p-3"><option value="Male">Macho</option><option value="Female">Fêmea</option></select>
              </label>
              <label className="text-sm">Raça
                <input value={breed} onChange={e => setBreed(e.target.value)} className="mt-1 w-full rounded-lg border p-3" />
              </label>
              <label className="text-sm">Categoria
                <input value={category} onChange={e => setCategory(e.target.value)} className="mt-1 w-full rounded-lg border p-3" />
              </label>
              <label className="text-sm">Lote/Pasto
                <select value={pasture} onChange={e => setPasture(e.target.value)} className="mt-1 w-full rounded-lg border p-3">
                  <option value="">Selecione um pasto cadastrado</option>
                  {pastures.map(item => <option key={item.id} value={item.name}>{item.name}</option>)}
                </select>
              </label>
            </div>
            <p className="text-xs text-outline">Pai, mãe e nascimento ficam para preenchimento posterior. Animais existentes não terão seus dados cadastrais substituídos automaticamente.</p>
          </div>
          <div className="max-h-80 overflow-auto rounded-lg border">
            <table className="w-full min-w-[600px] text-left text-sm">
              <thead className="sticky top-0 bg-surface-container-high"><tr><th className="p-2">IDE</th><th className="p-2">IDV</th><th className="p-2">Peso</th><th className="p-2">Data</th><th className="p-2">Situação</th></tr></thead>
              <tbody>{preview.map(row => <tr key={row.electronicId} className="border-t"><td className="p-2 font-mono">{row.electronicId}</td><td className="p-2">{row.visualId ?? 'Não informado'}</td><td className="p-2">{row.weightKg} kg</td><td className="p-2">{row.weighingDate} {row.weighingTime}</td><td className="p-2">{row.existing ? 'Nova pesagem' : 'Novo cadastro'}</td></tr>)}</tbody>
            </table>
          </div>
          <div className="space-y-2">
            <button type="button" onClick={confirmImport} disabled={saving || !pasture || !breed.trim() || !category.trim()} className="rounded-xl bg-primary px-6 py-3 font-bold text-white disabled:cursor-not-allowed disabled:opacity-40">
              {saving ? 'Gravando pesagens...' : `Confirmar importação de ${preview.length} pesagens`}
            </button>
            <p className="text-xs text-outline">Requer a migração SQL import_trutest_batch aplicada no Supabase. A operação é atômica: em caso de erro, nenhuma linha do lote é gravada.</p>
          </div>
        </>
      )}
    </section>
  )
}
