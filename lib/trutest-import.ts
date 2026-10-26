import Papa from 'papaparse'

/**
 * Leitor do CSV original da Tru-Test.
 * Não acessa o Supabase e não altera nenhum cadastro.
 */
export interface TruTestRow {
  line: number
  electronicId: string
  visualId: string | null
  weightKg: number
  weighingDate: string
  weighingTime: string
  gmd: number | null
  gpv: number | null
  classification: string | null
}

export interface TruTestParseResult {
  rows: TruTestRow[]
  errors: string[]
  warnings: string[]
  totalDataRows: number
}

const REQUIRED_COLUMNS = ['IDE', 'Peso', 'Data', 'Hora'] as const

function optionalNumber(raw: string | undefined): number | null {
  if (!raw?.trim()) return null
  const value = Number(raw.trim().replace(',', '.'))
  return Number.isFinite(value) ? value : null
}

function validDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false
  const [year, month, day] = date.split('-').map(Number)
  const parsed = new Date(Date.UTC(year, month - 1, day))
  return parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() + 1 === month &&
    parsed.getUTCDate() === day
}

export function parseTruTestCsv(csv: string): TruTestParseResult {
  const parsed = Papa.parse<Record<string, string>>(csv.replace(/^\uFEFF/, ''), {
    header: true,
    // Detecta automaticamente vírgula, ponto e vírgula ou tabulação.
    delimitersToGuess: [';', ',', '\t'],
    skipEmptyLines: 'greedy',
    transformHeader: (header) => header.trim().replace(/^\uFEFF/, ''),
  })

  const errors: string[] = parsed.errors.map(
    (error) => `CSV: linha ${(error.row ?? 0) + 2}: ${error.message}`
  )
  const warnings: string[] = []
  const rows: TruTestRow[] = []
  const fields = parsed.meta.fields ?? []
  const missing = REQUIRED_COLUMNS.filter((column) => !fields.includes(column))
  if (missing.length) {
    return {
      rows: [],
      errors: [`Arquivo Tru-Test inválido. Colunas ausentes: ${missing.join(', ')}.`, ...errors],
      warnings,
      totalDataRows: parsed.data.length,
    }
  }

  const seenElectronicIds = new Set<string>()
  parsed.data.forEach((record, index) => {
    const line = index + 2
    const electronicId = String(record.IDE ?? '').replace(/\s+/g, '')
    const visualId = String(record.IDV ?? '').trim() || null
    const weightRaw = String(record.Peso ?? '').trim()
    const weightKg = Number(weightRaw.replace(',', '.'))
    const weighingDate = String(record.Data ?? '').trim()
    const weighingTime = String(record.Hora ?? '').trim()

    if (!/^\d+$/.test(electronicId)) {
      errors.push(`Linha ${line}: IDE ausente ou inválido.`)
      return
    }
    if (seenElectronicIds.has(electronicId)) {
      errors.push(`Linha ${line}: IDE ${electronicId} repetido neste arquivo.`)
      return
    }
    if (!weightRaw || !Number.isFinite(weightKg) || weightKg <= 0 || weightKg > 3000) {
      errors.push(`Linha ${line}: peso inválido.`)
      return
    }
    if (!validDate(weighingDate) || !/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(weighingTime)) {
      errors.push(`Linha ${line}: data ou horário da pesagem inválido.`)
      return
    }

    seenElectronicIds.add(electronicId)
    rows.push({
      line,
      electronicId,
      visualId,
      weightKg,
      weighingDate,
      weighingTime,
      gmd: optionalNumber(record.GMD),
      gpv: optionalNumber(record.GPV),
      classification: String(record.Classificar ?? '').trim() || null,
    })
    if (!visualId) warnings.push(`Linha ${line}: IDV não informado; IDE será usado para identificação.`)
    if (record.GMD?.trim() && optionalNumber(record.GMD) === null) warnings.push(`Linha ${line}: GMD inválido, ignorado.`)
    if (record.GPV?.trim() && optionalNumber(record.GPV) === null) warnings.push(`Linha ${line}: GPV inválido, ignorado.`)
  })

  return { rows, errors, warnings, totalDataRows: parsed.data.length }
}
