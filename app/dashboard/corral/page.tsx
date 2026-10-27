'use client'

import React from 'react'
import { useRouter } from 'next/navigation'
import { motion } from 'motion/react'
import { 
  Scale, 
  Heart, 
  ShieldCheck, 
  Search, 
  Plus, 
  ChevronRight, 
  History,
  TrendingUp,
  Activity,
  Calendar,
  AlertCircle,
  FileText,
  Loader2,
  CheckCircle2,
  X,
  ArrowRight,
  ArrowLeft,
  FileUp,
  Sheet,
  Download
} from 'lucide-react'
import Papa from 'papaparse'
import * as XLSX from 'xlsx'
import DashboardLayout from '@/components/dashboard-layout'
import { cn } from '@/lib/utils'
import { supabase, isSupabaseConfigured } from '@/lib/supabase'

type ManagementTab = 'weight' | 'reproduction' | 'sanitary'

interface Cattle {
  id: string;
  tag_number: string;
  electronic_id: string | null;
  breed: string | null;
  category: string | null;
  gender: 'Male' | 'Female';
  weight_kg: number | null;
  birth_date: string | null;
}

function calculateAgeInMonths(birthDate: string): number {
  const birth = new Date(birthDate);
  const now = new Date();
  const months = (now.getFullYear() - birth.getFullYear()) * 12 + (now.getMonth() - birth.getMonth());
  return months;
}

export default function CorralPage() {
  const router = useRouter()
  const [activeTab, setActiveTab] = React.useState<ManagementTab>('weight')
  const [farmId, setFarmId] = React.useState<string | null>(null)
  const [isRecording, setIsRecording] = React.useState(false)
  const [isImporting, setIsImporting] = React.useState(false)
  const [importLoading, setImportLoading] = React.useState(false)
  const [importProgress, setImportProgress] = React.useState({ current: 0, total: 0 })
  const [importResults, setImportResults] = React.useState<{ success: number, error: number, details: string[] } | null>(null)
  
  const handleImportFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file || !isSupabaseConfigured()) return

    const farmId = localStorage.getItem('selectedFarmId')
    if (!farmId) {
      setError('Fazenda não selecionada.')
      return
    }

    setImportLoading(true)
    setImportResults(null)
    setImportProgress({ current: 0, total: 0 })

    const processData = async (data: any[]) => {
      const user = (await supabase.auth.getUser()).data.user
      const ownerId = user?.id
      
      setImportProgress({ current: 0, total: data.length })
      let successCount = 0
      let errorCount = 0
      const details: string[] = []
      
      const seenTagNumbers = new Set<string>()
      const seenElectronicIds = new Set<string>()

      for (let i = 0; i < data.length; i++) {
        const row = data[i]
        try {
          // New mappings based on user feedback
          const tagNumber = String(row.IDV || row.brinco || row.tag || row.Brinco || '').trim()
          const electronicId = String(row.IDE || row.brinco_eletronico || row.electronic_tag || '').trim()
          const weight = parseFloat(String(row.Peso || row.peso || row.weight || '0').replace(',', '.'))
          const classification = String(row.Classificar || row.Aparte || row.aparte || '').trim()
          const gmd = parseFloat(String(row.GMD || row.gmd || '0').replace(',', '.'))
          const gpv = parseFloat(String(row.GPV || row.gpv || '0').replace(',', '.'))
          const category = String(row.Categoria || row.categoria || row.category || row.Classificar || '').trim()
          
          // Better gender parsing to map to 'Male' or 'Female' standard expected by the application
          const rawGender = String(row.Sexo || row.sexo || row.gender || row.Sex || '').trim().toUpperCase()
          let gender: 'Male' | 'Female' | null = null
          if (rawGender.startsWith('F') || rawGender.includes('FEM') || rawGender === 'FÊMEA' || rawGender === 'FÉMEA' || rawGender.includes('MULHER')) {
            gender = 'Female'
          } else if (rawGender.startsWith('M') || rawGender.includes('MAC') || rawGender === 'MACHO') {
            gender = 'Male'
          }

          const notes = String(row.observações || row.obs || row.notes || '').trim()
          
          // Pasture and other fields fallback
          const pasture = String(row.pasto || row.lote || row.Pastoreio || row.pasture || '').trim()
          
          // Date handling (Data + Hora)
          const dateStr = String(row.data || row.date || row.Data || '').trim()
          const timeStr = String(row.hora || row.time || row.Hora || '').trim()
          let date = new Date().toISOString()
          
          if (dateStr) {
            try {
              let fullDateStr = dateStr
              
              // Handle DD/MM/YYYY format commonly used in Brazil
              if (dateStr.includes('/')) {
                const parts = dateStr.split('/')
                if (parts.length === 3) {
                  // Reformat to YYYY-MM-DD for standard parsing
                  // parts[2] is year, parts[1] is month, parts[0] is day
                  fullDateStr = `${parts[2]}-${parts[1]}-${parts[0]}`
                }
              }

              const finalDateStr = timeStr ? `${fullDateStr}T${timeStr}` : fullDateStr
              const parsedDate = new Date(finalDateStr)
              if (!isNaN(parsedDate.getTime())) {
                date = parsedDate.toISOString()
              } else {
                // Fallback for just date if time makes it invalid
                const fallbackDate = new Date(fullDateStr)
                if (!isNaN(fallbackDate.getTime())) {
                  date = fallbackDate.toISOString()
                }
              }
            } catch (e) {
              console.warn("Could not parse date:", dateStr, timeStr)
            }
          }

          if (!tagNumber && !electronicId) {
            errorCount++
            details.push(`Linha ${i + 1}: Brinco (IDV) ou Eletrônico (IDE) não informado.`)
            continue
          }

          // Check if already seen in current spreadsheet context
          if (tagNumber && seenTagNumbers.has(tagNumber)) {
            errorCount++
            details.push(`Linha ${i + 1}: Brinco (IDV) "${tagNumber}" duplicado na própria planilha. Registro ignorado.`)
            continue
          }
          if (electronicId && seenElectronicIds.has(electronicId)) {
            errorCount++
            details.push(`Linha ${i + 1}: Brinco Eletrônico (IDE) "${electronicId}" duplicado na própria planilha. Registro ignorado.`)
            continue
          }

          if (tagNumber) seenTagNumbers.add(tagNumber)
          if (electronicId) seenElectronicIds.add(electronicId)

          // 1. Find or create animal
          // Try to find by Tag Number OR Electronic ID
          let animalQuery = (supabase.from('cattle') as any).select('id, tag_number, electronic_id, gender, category').eq('farm_id', farmId)
          
          if (tagNumber && electronicId) {
            animalQuery = animalQuery.or(`tag_number.eq.${tagNumber},electronic_id.eq.${electronicId}`)
          } else if (tagNumber) {
            animalQuery = animalQuery.eq('tag_number', tagNumber)
          } else {
            animalQuery = animalQuery.eq('electronic_id', electronicId)
          }

          const { data: existingAnimals, error: findError } = await animalQuery

          if (findError) throw findError
          
          if (existingAnimals && existingAnimals.length > 0) {
            // Repetition detected! Report alert/error and prohibit registration
            const matched = existingAnimals[0]
            const duplicateField = (tagNumber && matched.tag_number === tagNumber) 
              ? `Brinco (IDV) "${tagNumber}"` 
              : `Eletrônico (IDE) "${electronicId}"`
            
            errorCount++
            details.push(`Linha ${i + 1}: Animal com ${duplicateField} já está cadastrado nesta fazenda. Cadastro impedido para evitar duplicidade.`)
            continue
          }

          // Create new animal (if we arrived here, we are sure it's not a duplicate)
          const { data: newAnimal, error: createError } = await (supabase
            .from('cattle') as any)
            .insert({
              farm_id: farmId,
              owner_id: ownerId,
              tag_number: tagNumber || `AUTO-${Date.now()}`, // Fallback if only IDE is provided
              electronic_id: electronicId || null,
              gender: ['Male', 'Female'].includes(gender || '') ? gender : null,
              pasture: pasture || null,
              category: category || null,
              weight_kg: weight || null,
              status: 'Active'
            })
            .select('id')
            .single()

          if (createError) throw createError
          const animalId = (newAnimal as any).id

          // 2. Record weight if provided
          if (weight > 0) {
            const { error: weightError } = await (supabase.from('weighings') as any).insert({
              cattle_id: animalId,
              farm_id: farmId,
              weight_kg: weight,
              classification: classification || null,
              gmd: gmd || null,
              gpv: gpv || null,
              notes: notes || null,
              inserted_at: date
            })
            if (weightError) throw weightError

            // Update cattle current weight
            await (supabase.from('cattle') as any).update({ weight_kg: weight }).eq('id', animalId)
          }

          successCount++
        } catch (err: any) {
          console.error(`Error processing row ${i + 1}:`, err)
          errorCount++
          const errorMessage = err.message || err.details || JSON.stringify(err) || 'Erro desconhecido'
          details.push(`Linha ${i + 1} (${row.IDV || row.brinco || row.IDE || 'N/A'}): ${errorMessage}`)
        }
        setImportProgress(prev => ({ ...prev, current: i + 1 }))
      }

      setImportResults({ success: successCount, error: errorCount, details })
      setImportLoading(false)
      fetchPendingAnimals()
    }

    if (file.name.endsWith('.csv')) {
      Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        complete: (results) => {
          processData(results.data)
        },
        error: (err) => {
          setError(`Erro ao ler CSV: ${err.message}`)
          setImportLoading(false)
        }
      })
    } else {
      const reader = new FileReader()
      reader.onload = (e) => {
        try {
          const data = new Uint8Array(e.target?.result as ArrayBuffer)
          const workbook = XLSX.read(data, { type: 'array' })
          const firstSheetName = workbook.SheetNames[0]
          const worksheet = workbook.Sheets[firstSheetName]
          const jsonData = XLSX.utils.sheet_to_json(worksheet)
          processData(jsonData)
        } catch (err: any) {
          setError(`Erro ao ler Excel: ${err.message}`)
          setImportLoading(false)
        }
      }
      reader.readAsArrayBuffer(file)
    }
  }

  const downloadTemplate = () => {
    const headers = ['IDV', 'IDE', 'Peso', 'GMD', 'GPV', 'Classificar', 'Data', 'Hora', 'Sexo', 'Categoria', 'observações']
    const sampleRow = ['123', '982000123456789', '450,5', '1,2', '45,0', 'Aparte A', '18/05/2024', '08:30', 'M', 'Garrote', 'Animal em ótimo estado']
    
    // Use semicolon for Brazilian Excel compatibility
    const csvContent = [
      headers.join(';'),
      sampleRow.join(';')
    ].join('\n')
    
    // Add UTF-8 BOM (\uFEFF) for proper encoding of accented characters in Excel
    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' })
    const link = document.createElement('a')
    const url = URL.createObjectURL(blob)
    link.setAttribute('href', url)
    link.setAttribute('download', 'modelo_importacao_curral.csv')
    link.style.visibility = 'hidden'
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }
  const [searchQuery, setSearchQuery] = React.useState('')
  const [isSearching, setIsSearching] = React.useState(false)
  const [selectedAnimal, setSelectedAnimal] = React.useState<Cattle | null>(null)
  const [lastReproEvent, setLastReproEvent] = React.useState<any>(null)
  const [pendingAnimals, setPendingAnimals] = React.useState<any[]>([])
  const [showFullHistory, setShowFullHistory] = React.useState(false)
  const [refreshMessage, setRefreshMessage] = React.useState('')
  const [historySearch, setHistorySearch] = React.useState('')
  const [sortConfig, setSortConfig] = React.useState<{ key: string, direction: 'asc' | 'desc' } | null>({ key: 'date', direction: 'desc' })
  const [loadingPending, setLoadingPending] = React.useState(false)
  const [loading, setLoading] = React.useState(false)
  const [status, setStatus] = React.useState<'idle' | 'success' | 'error'>('idle')
  const [error, setError] = React.useState<string | null>(null)
  const [warning, setWarning] = React.useState<string | null>(null)
  const [statsData, setStatsData] = React.useState({
    weight: { todayCount: '0', avgGmd: '0.0 kg' },
    reproduction: { observing: '0', expectedBirths: '0' },
    sanitary: { pending: '0', lastVaccination: 'N/A' }
  })

  // Track Farm Changes
  React.useEffect(() => {
    const checkFarm = () => {
      const currentFarmId = localStorage.getItem('selectedFarmId')
      if (currentFarmId !== farmId) {
        setFarmId(currentFarmId)
        // Clear state on farm change
        setPendingAnimals([])
        setStatsData({
          weight: { todayCount: '0', avgGmd: '0.0 kg' },
          reproduction: { observing: '0', expectedBirths: '0' },
          sanitary: { pending: '0', lastVaccination: 'N/A' }
        })
        setSelectedAnimal(null)
      }
    }

    checkFarm()
    const interval = setInterval(checkFarm, 1000) // Poll for changes
    return () => clearInterval(interval)
  }, [farmId])

  // Form states
  const [weightValue, setWeightValue] = React.useState('')
  const [reproType, setReproType] = React.useState('insemination')
  const [reproStatus, setReproStatus] = React.useState('pregnant')
  const [selectedBull, setSelectedBull] = React.useState<Cattle | null>(null)
  const [selectedSemen, setSelectedSemen] = React.useState<any>(null)
  const [semenList, setSemenList] = React.useState<any[]>([])
  const [aptBulls, setAptBulls] = React.useState<Cattle[]>([])
  const [sanitaryType, setSanitaryType] = React.useState('vaccination')
  const [medication, setMedication] = React.useState('')
  const [notes, setNotes] = React.useState('')

  const fetchLastReproEvent = async (animalId: string) => {
    if (!isSupabaseConfigured()) return null
    try {
      const { data, error } = await supabase
        .from('reproduction_events')
        .select('*')
        .eq('cattle_id', animalId)
        .order('inserted_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      
      if (error) throw error
      return data
    } catch (err) {
      console.error('Error fetching last repro event:', err)
      return null
    }
  }

  const sortedPendingAnimals = React.useMemo(() => {
    let sortableItems = [...pendingAnimals];
    if (sortConfig !== null) {
      sortableItems.sort((a, b) => {
        let aValue: any;
        let bValue: any;

        if (sortConfig.key === 'tag_number') {
          aValue = a.cattle?.tag_number || '';
          bValue = b.cattle?.tag_number || '';
          const aNum = parseFloat(aValue);
          const bNum = parseFloat(bValue);
          if (!isNaN(aNum) && !isNaN(bNum)) {
            return sortConfig.direction === 'asc' ? aNum - bNum : bNum - aNum;
          }
        } else if (sortConfig.key === 'date') {
          aValue = new Date(activeTab === 'weight' ? (a.weighing_date || a.inserted_at) : a.inserted_at).getTime();
          bValue = new Date(activeTab === 'weight' ? (b.weighing_date || b.inserted_at) : b.inserted_at).getTime();
        } else if (sortConfig.key === 'value') {
          if (activeTab === 'weight') {
            aValue = a.weight_kg || 0;
            bValue = b.weight_kg || 0;
          } else if (activeTab === 'reproduction') {
            aValue = a.event_type || '';
            bValue = b.event_type || '';
          } else {
            aValue = a.medication || a.record_type || '';
            bValue = b.medication || b.record_type || '';
          }
        } else if (sortConfig.key === 'pasture') {
          aValue = a.cattle?.pasture || '';
          bValue = b.cattle?.pasture || '';
        }

        if (aValue < bValue) return sortConfig.direction === 'asc' ? -1 : 1;
        if (aValue > bValue) return sortConfig.direction === 'asc' ? 1 : -1;
        return 0;
      });
    }
    return sortableItems;
  }, [pendingAnimals, sortConfig, activeTab]);

  const requestSort = (key: string) => {
    let direction: 'asc' | 'desc' = 'asc';
    if (sortConfig && sortConfig.key === key && sortConfig.direction === 'asc') {
      direction = 'desc';
    }
    setSortConfig({ key, direction });
  };

  const getSortIcon = (key: string) => {
    if (!sortConfig || sortConfig.key !== key) {
      return <TrendingUp className="w-3 h-3 opacity-20" />;
    }
    return sortConfig.direction === 'asc' ? 
      <TrendingUp className="w-3 h-3 text-primary rotate-0 transition-transform" /> : 
      <TrendingUp className="w-3 h-3 text-primary rotate-180 transition-transform" />;
  };

  const fetchPendingAnimals = React.useCallback(async () => {
    if (!isSupabaseConfigured() || !farmId) {
      console.log('Skipping fetchPendingAnimals: Supabase not configured or farmId missing', { farmId })
      return
    }

    setLoadingPending(true)
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      if (activeTab === 'reproduction') {
        const { data, error: eventsError } = await supabase
          .from('reproduction_events')
          .select(`
            *,
            cattle (
              id,
              tag_number,
              farm_id,
              pasture
            )
          `)
          .eq('farm_id', farmId)
          .order('inserted_at', { ascending: false })
          .limit(500)

        if (eventsError) {
          console.error('Error fetching repro events:', eventsError)
          throw eventsError
        }
        
        const recentEvents: any[] = data || []
        console.log(`Fetched ${recentEvents.length} repro events for farm ${farmId}`)
        
        const latestPerAnimal = new Map()
        recentEvents.forEach(event => {
          if (!latestPerAnimal.has(event.cattle_id)) {
            latestPerAnimal.set(event.cattle_id, event)
          }
        })

        const allLatestEvents = Array.from(latestPerAnimal.values())
        const pending = allLatestEvents.filter(event => 
          event.event_type === 'insemination' || event.event_type === 'mating'
        )

        const pregnantCount = allLatestEvents.filter(event => 
          event.event_type === 'diagnosis' && event.status === 'pregnant'
        ).length

        setPendingAnimals(pending)
        setStatsData(prev => ({
          ...prev,
          reproduction: {
            observing: pending.length.toString(),
            expectedBirths: pregnantCount.toString()
          }
        }))
      } else if (activeTab === 'weight') {
        const { data: recentWeights, error: weightError } = await supabase
          .from('weighings')
          .select(`
            *,
            cattle (id, tag_number, farm_id, pasture)
          `)
          .eq('farm_id', farmId)
          .order('weighing_date', { ascending: false })
          .limit(500)
        
        if (weightError) {
          console.error('Error fetching weights:', weightError)
          throw weightError
        }

        const weightsList = (recentWeights as any[]) || []
        console.log(`Fetched ${weightsList.length} weights for farm ${farmId}`)
        setPendingAnimals(weightsList)

        const todayCount = weightsList.filter(w => new Date(w.weighing_date || w.inserted_at) >= today).length
        
        const animalWeightsMap = new Map<string, any[]>();
        weightsList.forEach(w => {
          if (!animalWeightsMap.has(w.cattle_id)) {
            animalWeightsMap.set(w.cattle_id, []);
          }
          animalWeightsMap.get(w.cattle_id)?.push(w);
        });

        let totalGmd = 0;
        let gmdCount = 0;

        animalWeightsMap.forEach((animalWeights) => {
          if (animalWeights.length >= 2) {
            const latest = animalWeights[0];
            const previous = animalWeights[1];
            const weightDiff = latest.weight_kg - previous.weight_kg;
            const timeDiff = new Date(latest.weighing_date || latest.inserted_at).getTime() - new Date(previous.weighing_date || previous.inserted_at).getTime();
            const days = timeDiff / (1000 * 3600 * 24);
            
            if (days > 0.5) {
              totalGmd += weightDiff / days;
              gmdCount++;
            }
          }
        });
        
        setStatsData(prev => ({
          ...prev,
          weight: {
            todayCount: todayCount.toString(),
            avgGmd: gmdCount > 0 ? (totalGmd / gmdCount).toFixed(2) + ' kg' : '0.0 kg'
          }
        }))
      } else if (activeTab === 'sanitary') {
        const { data: recentHealth, error: healthError } = await supabase
          .from('health_records')
          .select(`
            *,
            cattle (id, tag_number, farm_id, pasture)
          `)
          .eq('farm_id', farmId)
          .order('inserted_at', { ascending: false })
          .limit(100)
          
        if (healthError) {
          console.error('Error fetching health records:', healthError)
          throw healthError
        }
        const healthList = (recentHealth as any[]) || []
        console.log(`Fetched ${healthList.length} health records for farm ${farmId}`)
        setPendingAnimals(healthList.slice(0, 10))

        const lastVaccination = healthList.find(h => h.record_type === 'vaccination')
        const lastDate = lastVaccination ? new Date(lastVaccination.inserted_at).toLocaleDateString('pt-BR') : 'N/A'

        setStatsData(prev => ({
          ...prev,
          sanitary: {
            pending: '0', 
            lastVaccination: lastDate
          }
        }))
      }
    } catch (err: any) {
      console.error('Error fetching pending/recent:', err.message || err)
    } finally {
      setLoadingPending(false)
    }
  }, [activeTab, farmId])

  React.useEffect(() => {
    fetchPendingAnimals()
  }, [activeTab, fetchPendingAnimals])

  const fetchAptBulls = React.useCallback(async () => {
    if (!isSupabaseConfigured() || !farmId) return
    try {
      const { data, error } = await supabase
        .from('cattle')
        .select('*')
        .eq('farm_id', farmId)
        .eq('gender', 'Male')
        .gte('weight_kg', 350)

      if (error) throw error
      
      // Filter by age > 24 months
      const filtered = (data || []).filter((bull: any) => bull.birth_date && calculateAgeInMonths(bull.birth_date) > 24)
      setAptBulls(filtered as Cattle[])
    } catch (err) {
      console.error('Error fetching bulls:', err)
    }
  }, [])

  const fetchSemen = React.useCallback(async () => {
    if (!isSupabaseConfigured() || !farmId) return
    try {
      const { data, error } = await (supabase.from('semen_tank') as any)
        .select('*')
        .eq('farm_id', farmId)
        .gt('dose_count', 0)

      if (error) {
        if (error.code === '42P01') return
        throw error
      }
      setSemenList(data || [])
    } catch (err) {
      console.error('Error fetching semen:', err)
    }
  }, [])

  React.useEffect(() => {
    if (activeTab === 'reproduction') {
      const timer = setTimeout(() => {
        fetchAptBulls()
        fetchSemen()
      }, 0)
      return () => clearTimeout(timer)
    }
  }, [activeTab, fetchAptBulls, fetchSemen])

  const handleSearchAnimal = async (e?: React.FormEvent, directQuery?: string) => {
    if (e) e.preventDefault()
    const query = directQuery || searchQuery
    if (!query || !isSupabaseConfigured()) return

    setIsSearching(true)
    setSelectedAnimal(null)
    setLastReproEvent(null)
    setError(null)
    setWarning(null)
    setReproType('insemination')

    try {
      const farmId = localStorage.getItem('selectedFarmId')
      if (!farmId) {
        setError('Fazenda não selecionada.')
        setIsSearching(false)
        return
      }

      const { data, error } = await supabase
        .from('cattle')
        .select('*')
        .eq('farm_id', farmId)
        .or(`tag_number.eq.${query},electronic_id.eq.${query}`)
        .maybeSingle()

      if (error) throw error
      if (data) {
        const animal = data as Cattle;
        
        // Validation for reproduction tab
        if (activeTab === 'reproduction') {
          const ageMonths = animal.birth_date ? calculateAgeInMonths(animal.birth_date) : 0;
          const isFemale = animal.gender === 'Female';
          const isHeavyEnough = (animal.weight_kg || 0) >= 280;
          const isOldEnough = ageMonths > 18;

          if (!isFemale) {
            setError('Manejo reprodutivo permitido apenas para fêmeas.');
            setIsSearching(false);
            return;
          }

          if (!isOldEnough || !isHeavyEnough) {
            const reasons: string[] = [];
            if (!isOldEnough) reasons.push(`idade insuficiente (${ageMonths} meses)`);
            if (!isHeavyEnough) reasons.push(`peso insuficiente (${animal.weight_kg || 0}kg)`);
            setError(`Fêmea inapta: ${reasons.join(' e ')}. (Mínimo: 18 meses e 280kg)`);
            setIsSearching(false);
            return;
          }

          // Fetch reproductive history
          const lastEvent: any = await fetchLastReproEvent(animal.id);
          setLastReproEvent(lastEvent);

          if (lastEvent) {
            const wasReproAction = lastEvent.event_type === 'insemination' || lastEvent.event_type === 'mating';
            const isPregnant = lastEvent.event_type === 'diagnosis' && lastEvent.status === 'pregnant';

            if (wasReproAction) {
              setWarning('Animal aguardando Diagnóstico de Gestação.');
              setReproType('diagnosis');
            } else if (isPregnant) {
              setWarning('Animal já confirmado como PRENHA. Aguardando Parto.');
              // We could force 'birth' but maybe they just want to check. 
              // For now let's just warn and let them choose 'birth' if they want.
            }
          }
        }

        setSelectedAnimal(animal)
      } else {
        setError('Animal não encontrado. Verifique o número do brinco ou IDE.')
      }
    } catch (err: any) {
      console.error('Search error:', err)
      setError('Erro ao buscar animal.')
    } finally {
      setIsSearching(false)
    }
  }

  const handleSaveManejo = async () => {
    if (!selectedAnimal || !isSupabaseConfigured()) return
    setLoading(true)
    setStatus('idle')

    try {
      const farmId = localStorage.getItem('selectedFarmId')
      if (!farmId) throw new Error('Fazenda não selecionada.')

      // Specific Reproduction Validations
      if (activeTab === 'reproduction') {
        const isNewAction = reproType === 'insemination' || reproType === 'mating';
        const isDiagnosis = reproType === 'diagnosis';

        if (isNewAction) {
          // Rule: If last event was insemination/mating and no diagnosis followed, or if last diagnosis was pregnant
          if (lastReproEvent) {
            const wasReproAction = lastReproEvent.event_type === 'insemination' || lastReproEvent.event_type === 'mating';
            const waitDiagnosis = wasReproAction;
            const isPregnant = lastReproEvent.event_type === 'diagnosis' && lastReproEvent.status === 'pregnant';

            if (waitDiagnosis) {
              throw new Error('Aguardando Diagnóstico de Gestação do evento anterior.');
            }
            if (isPregnant) {
              throw new Error('Animal já confirmado como Prenha no último diagnóstico.');
            }
          }
        }

        if (isDiagnosis) {
          if (!lastReproEvent) {
            throw new Error('Não há evento reprodutivo anterior (IA/Monta) para diagnosticar.');
          }
          
          const wasReproAction = lastReproEvent.event_type === 'insemination' || lastReproEvent.event_type === 'mating';
          if (!wasReproAction) {
             throw new Error('Último evento não foi uma Inseminação ou Monta.');
          }

          // Rule: Diagnosis >= 28 days after
          const lastDate = new Date(lastReproEvent.inserted_at);
          const now = new Date();
          const daysDiff = (now.getTime() - lastDate.getTime()) / (1000 * 3600 * 24);
          
          if (daysDiff < 28) {
            throw new Error(`Diagnóstico precoce. Aguarde pelo menos 28 dias (Faltam ${Math.ceil(28 - daysDiff)} dias).`);
          }
        }
      }
      
      if (activeTab === 'weight') {
        const { error: weightError } = await (supabase.from('weighings') as any).insert({
          cattle_id: selectedAnimal.id,
          farm_id: farmId,
          weight_kg: parseFloat(weightValue),
          notes
        })
        if (weightError) throw weightError

        // Update current animal weight
        await (supabase.from('cattle') as any).update({ weight_kg: parseFloat(weightValue) }).eq('id', selectedAnimal.id)
      } 
      else if (activeTab === 'reproduction') {
        const eventData: any = {
          cattle_id: selectedAnimal.id,
          farm_id: farmId,
          event_type: reproType,
          status: reproType === 'diagnosis' ? reproStatus : (reproType === 'insemination' ? 'IA Realizada' : 'Monta Realizada'),
          notes
        };

        if (reproType === 'insemination' && selectedSemen) {
          eventData.semen_bull = selectedSemen.bull_name;
          // Decrement dose count
          await (supabase.from('semen_tank') as any).update({ dose_count: selectedSemen.dose_count - 1 }).eq('id', selectedSemen.id);
        } else if (reproType === 'mating' && selectedBull) {
          eventData.male_bull_tag = selectedBull.tag_number;
        }

        const { error: reproError } = await (supabase.from('reproduction_events') as any).insert(eventData)
        if (reproError) throw reproError
      }
      else if (activeTab === 'sanitary') {
        const { error: sanitaryError } = await (supabase.from('health_records') as any).insert({
          cattle_id: selectedAnimal.id,
          farm_id: farmId,
          record_type: sanitaryType,
          medication,
          description: notes
        })
        if (sanitaryError) throw sanitaryError
      }

      setStatus('success')
      // Refresh data
      fetchPendingAnimals()
      
      // Reset form
      setTimeout(() => {
        setSelectedAnimal(null)
        setSearchQuery('')
        setWeightValue('')
        setNotes('')
        setMedication('')
        setStatus('idle')
      }, 2000)

    } catch (err: any) {
      console.error('Save error:', err)
      setStatus('error')
      setError(err.message || 'Erro ao salvar manejo.')
    } finally {
      setLoading(false)
    }
  }

  const tabContent = {
    weight: {
      title: 'Manejo de Pesagem',
      icon: Scale,
      color: 'text-blue-600',
      description: 'Registre e acompanhe a evolução de peso do seu rebanho.',
      stats: [
        { label: 'Pesagens Hoje', value: statsData.weight.todayCount, icon: History },
        { label: 'Ganho Médio Diário', value: statsData.weight.avgGmd, icon: TrendingUp },
      ]
    },
    reproduction: {
      title: 'Manejo Reprodutivo',
      icon: Heart,
      color: 'text-pink-600',
      description: 'Controle de monta, inseminação e diagnósticos de gestação.',
      stats: [
        { label: 'Em Observação', value: statsData.reproduction.observing, icon: Activity },
        { label: 'Partos Previstos', value: statsData.reproduction.expectedBirths, icon: Calendar },
      ]
    },
    sanitary: {
      title: 'Manejo Sanitário',
      icon: ShieldCheck,
      color: 'text-emerald-600',
      description: 'Controle de vacinas, vermífugos e tratamentos curativos.',
      stats: [
        { label: 'Protocolos Pendentes', value: statsData.sanitary.pending, icon: AlertCircle },
        { label: 'Última Vacinação', value: statsData.sanitary.lastVaccination, icon: CheckCircle2 },
      ]
    }
  }

  const ActiveIcon = tabContent[activeTab].icon

  if (isRecording) {
    return (
      <DashboardLayout>
        <div className="max-w-4xl mx-auto pb-20">
          <header className="flex items-center justify-between mb-8">
            <button 
              onClick={() => setIsRecording(false)}
              className="flex items-center gap-2 text-outline font-bold hover:text-on-surface transition-colors"
            >
              <ArrowLeft className="w-5 h-5" /> Sair do Manejo
            </button>
            <div className="flex items-center gap-3">
              <div className={cn("p-2 rounded-lg bg-surface-container-high", tabContent[activeTab].color)}>
                <ActiveIcon className="w-5 h-5" />
              </div>
              <h1 className="text-xl font-bold">{tabContent[activeTab].title}</h1>
            </div>
          </header>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {/* Search/Selection Column */}
            <div className="md:col-span-1 space-y-6">
              <div className="bg-surface-container-lowest p-6 rounded-2xl border border-outline-variant shadow-sm">
                <h3 className="text-xs uppercase tracking-widest font-black text-outline mb-4">Identificar Animal</h3>
                <form onSubmit={handleSearchAnimal} className="relative">
                  <input 
                    type="text" 
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Brinco ou IDE"
                    className="w-full pl-4 pr-10 py-3 bg-surface-container-low border border-outline-variant rounded-xl font-bold outline-none focus:border-primary transition-all"
                  />
                  <button type="submit" className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 hover:bg-surface-container-high rounded-lg transition-colors">
                    {isSearching ? <Loader2 className="w-4 h-4 animate-spin text-primary" /> : <Search className="w-4 h-4 text-outline" />}
                  </button>
                </form>

                {error && <p className="mt-3 text-[10px] text-red-600 font-bold uppercase">{error}</p>}
                {warning && !error && (
                  <div className="mt-3 flex items-center gap-2 p-2 bg-amber-50 border border-amber-100 rounded-lg">
                    <AlertCircle className="w-3 h-3 text-amber-600" />
                    <p className="text-[9px] text-amber-700 font-bold uppercase">{warning}</p>
                  </div>
                )}

                {selectedAnimal && (
                  <motion.div 
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="mt-6 pt-6 border-t border-outline-variant"
                  >
                    <div className="flex items-center gap-4 mb-4">
                      <div className="w-12 h-12 bg-primary/10 rounded-xl flex items-center justify-center text-primary font-black">
                        {selectedAnimal.tag_number}
                      </div>
                      <div>
                        <p className="text-xs font-black text-outline uppercase">Brinco</p>
                        <p className="font-bold text-on-surface">{selectedAnimal.breed || 'NELORE'}</p>
                      </div>
                    </div>
                    <div className="space-y-2">
                       <div className="flex justify-between text-[10px] font-bold uppercase tracking-widest text-outline">
                         <span>Peso Atual</span>
                         <span className="text-on-surface">{selectedAnimal.weight_kg ? `${selectedAnimal.weight_kg}kg` : 'N/A'}</span>
                       </div>
                       <div className="flex justify-between text-[10px] font-bold uppercase tracking-widest text-outline">
                         <span>Categoria</span>
                         <span className="text-on-surface">{selectedAnimal.category || 'N/A'}</span>
                       </div>
                    </div>
                  </motion.div>
                )}
              </div>
              
              <div className="bg-surface-container-high/30 p-6 rounded-2xl border border-dashed border-outline-variant">
                <p className="text-[10px] font-bold text-outline opacity-70 leading-relaxed uppercase">
                  Identifique o animal para habilitar o registro de manejo.
                </p>
              </div>
            </div>

            {/* Form Column */}
            <div className="md:col-span-2">
              <section className={cn(
                "bg-surface-container-lowest p-8 rounded-[2rem] border border-outline-variant shadow-sm transition-all",
                !selectedAnimal && "opacity-50 pointer-events-none grayscale"
              )}>
                <h2 className="text-2xl font-bold mb-8 flex items-center gap-3">
                  <Plus className="w-6 h-6 text-primary" />
                  Novo Registro
                </h2>

                <div className="space-y-8">
                  {activeTab === 'weight' && (
                    <div className="space-y-6">
                      <div className="space-y-2">
                        <label className="text-xs uppercase tracking-widest font-black text-outline">Peso Registrado (kg)</label>
                        <div className="relative">
                          <Scale className="absolute left-4 top-1/2 -translate-y-1/2 text-outline w-5 h-5" />
                          <input 
                            type="number" 
                            step="0.01"
                            value={weightValue}
                            onChange={(e) => setWeightValue(e.target.value)}
                            className="w-full pl-12 p-5 bg-surface-container-low border border-outline-variant rounded-2xl text-2xl font-black outline-none focus:border-primary transition-all"
                            placeholder="0.00"
                          />
                        </div>
                      </div>
                    </div>
                  )}

                  {activeTab === 'reproduction' && (
                    <div className="space-y-6">
                      {warning && (
                        <div className="p-4 bg-amber-50 border border-amber-200 rounded-2xl flex items-start gap-3">
                          <AlertCircle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                          <div>
                            <p className="text-sm font-bold text-amber-900">Atenção ao Manejo</p>
                            <p className="text-xs text-amber-800 font-medium mt-1">
                              {warning} Novos registros de IA ou Monta estão restringidos até a conclusão do ciclo atual.
                            </p>
                          </div>
                        </div>
                      )}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="space-y-2">
                          <label className="text-xs uppercase tracking-widest font-black text-outline">Tipo de Evento</label>
                          <select 
                            value={reproType}
                            disabled={warning?.includes('aguardando Diagnóstico')}
                            onChange={(e) => {
                              const val = e.target.value;
                              setReproType(val);
                              // Automatic redirection for birth
                              if (val === 'birth') {
                                router.push('/dashboard/herd?tab=form');
                              }
                            }}
                            className="w-full p-4 bg-surface-container-low border border-outline-variant rounded-xl font-bold outline-none focus:border-primary transition-all appearance-none disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            <option value="insemination">Inseminação (IA)</option>
                            <option value="mating">Monta Natural</option>
                            <option value="diagnosis">Diagnóstico Gestação</option>
                            <option value="birth">Parto (Nascimento)</option>
                          </select>
                        </div>
                        
                        {reproType === 'diagnosis' && (
                          <div className="space-y-2">
                            <label className="text-xs uppercase tracking-widest font-black text-outline">Resultado / Status</label>
                            <select 
                              value={reproStatus}
                              onChange={(e) => setReproStatus(e.target.value)}
                              className="w-full p-4 bg-surface-container-low border border-outline-variant rounded-xl font-bold outline-none focus:border-primary transition-all appearance-none"
                            >
                              <option value="pregnant">Prenha</option>
                              <option value="empty">Vazia</option>
                              <option value="retoque">Retoque</option>
                            </select>
                          </div>
                        )}

                        {reproType === 'insemination' && (
                          <div className="space-y-2">
                            <label className="text-xs uppercase tracking-widest font-black text-outline">Selecionar Sêmen (Touro)</label>
                            <select 
                              value={selectedSemen?.id || ''}
                              onChange={(e) => {
                                const semen = semenList.find(s => s.id === e.target.value);
                                setSelectedSemen(semen);
                              }}
                              className="w-full p-4 bg-surface-container-low border border-outline-variant rounded-xl font-bold outline-none focus:border-primary transition-all appearance-none"
                            >
                              <option value="">Selecione o sêmen</option>
                              {semenList.map(s => (
                                <option key={s.id} value={s.id}>{s.bull_name} ({s.bull_breed}) - {s.dose_count} doses</option>
                              ))}
                            </select>
                          </div>
                        )}

                        {reproType === 'mating' && (
                          <div className="space-y-2">
                            <label className="text-xs uppercase tracking-widest font-black text-outline">Selecionar Touro Aptos</label>
                            <select 
                                value={selectedBull?.id || ''}
                                onChange={(e) => {
                                  const bull = aptBulls.find(b => b.id === e.target.value);
                                  setSelectedBull(bull || null);
                                }}
                                className="w-full p-4 bg-surface-container-low border border-outline-variant rounded-xl font-bold outline-none focus:border-primary transition-all appearance-none"
                              >
                                <option value="">Selecione um touro apto</option>
                                {aptBulls.map(b => (
                                  <option key={b.id} value={b.id}>{b.tag_number} - {b.weight_kg}kg</option>
                                ))}
                              </select>
                              {aptBulls.length === 0 && <p className="text-[10px] text-amber-600 font-bold uppercase mt-1">Nenhum touro apto encontrado ({">"}24m e {">"}350kg)</p>}
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {activeTab === 'sanitary' && (
                    <div className="space-y-6">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="space-y-2">
                          <label className="text-xs uppercase tracking-widest font-black text-outline">Tipo de Manejo</label>
                          <select 
                            value={sanitaryType}
                            onChange={(e) => setSanitaryType(e.target.value)}
                            className="w-full p-4 bg-surface-container-low border border-outline-variant rounded-xl font-bold outline-none focus:border-primary transition-all appearance-none"
                          >
                            <option value="vaccination">Vacinação</option>
                            <option value="deworming">Vermifugação</option>
                            <option value="treatment">Tratamento Curativo</option>
                          </select>
                        </div>
                        <div className="space-y-2">
                          <label className="text-xs uppercase tracking-widest font-black text-outline">Medicamento / Produto</label>
                          <input 
                            value={medication}
                            onChange={(e) => setMedication(e.target.value)}
                            className="w-full p-4 bg-surface-container-low border border-outline-variant rounded-xl font-bold outline-none focus:border-primary transition-all"
                            placeholder="Nome do produto"
                          />
                        </div>
                      </div>
                    </div>
                  )}

                  <div className="space-y-2">
                    <label className="text-xs uppercase tracking-widest font-black text-outline">Observações</label>
                    <textarea 
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      rows={3}
                      className="w-full p-4 bg-surface-container-low border border-outline-variant rounded-xl font-medium outline-none focus:border-primary transition-all resize-none"
                      placeholder="Algum comentário adicional..."
                    />
                  </div>

                  <div className="pt-6 border-t border-outline-variant">
                    <button 
                      onClick={handleSaveManejo}
                      disabled={loading || status === 'success'}
                      className={cn(
                        "w-full py-5 rounded-2xl font-black text-xl flex items-center justify-center gap-3 transition-all",
                        status === 'success' 
                          ? "bg-green-500 text-white" 
                          : "bg-primary text-white hover:brightness-110 shadow-xl shadow-primary/20 rotate-0 active:scale-[0.98]"
                      )}
                    >
                      {loading ? <Loader2 className="w-6 h-6 animate-spin" /> : status === 'success' ? <CheckCircle2 className="w-6 h-6" /> : <Plus className="w-6 h-6" />}
                      {status === 'success' ? 'Salvo!' : 'Confirmar Manejo'}
                    </button>
                    {status === 'success' && (
                      <p className="text-center mt-4 text-xs font-bold text-green-600 uppercase tracking-widest animate-pulse">
                        Manejo registrado com sucesso. Aguarde...
                      </p>
                    )}
                  </div>
                </div>
              </section>
            </div>
          </div>
        </div>
      </DashboardLayout>
    )
  }

  return (
    <DashboardLayout>
      <div className="max-w-6xl mx-auto space-y-8">
        <header className="flex flex-col md:flex-row md:items-end justify-between gap-6">
          <div>
            <h1 className="text-4xl font-black text-primary tracking-tight">Curral</h1>
            <p className="text-outline font-medium mt-1">Gestão operacional do rebanho</p>
          </div>
          
          <div className="flex bg-surface-container-low p-1.5 rounded-2xl border border-outline-variant">
            {(['weight', 'reproduction', 'sanitary'] as ManagementTab[]).map((tab) => (
              <button
                key={tab}
                onClick={() => {
                  setActiveTab(tab)
                  setSelectedAnimal(null)
                  setError(null)
                  setSearchQuery('')
                }}
                className={cn(
                  "px-6 py-2.5 rounded-xl text-sm font-bold transition-all flex items-center gap-2",
                  activeTab === tab 
                    ? "bg-white text-primary shadow-sm" 
                    : "text-outline hover:text-on-surface hover:bg-surface-container-high"
                )}
              >
                {tab === 'weight' && <Scale className="w-4 h-4" />}
                {tab === 'reproduction' && <Heart className="w-4 h-4" />}
                {tab === 'sanitary' && <ShieldCheck className="w-4 h-4" />}
                {tab === 'weight' && 'Pesagem'}
                {tab === 'reproduction' && 'Reprodutivo'}
                {tab === 'sanitary' && 'Sanitário'}
              </button>
            ))}
          </div>
        </header>

        <motion.div
          key={activeTab}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-8"
        >
          {/* Section Hero */}
          <section className="bg-surface-container-lowest p-8 md:p-12 rounded-[2.5rem] border border-outline-variant relative overflow-hidden">
            <div className="absolute right-0 top-0 w-64 h-64 bg-primary/5 rounded-full -translate-y-1/2 translate-x-1/2 blur-3xl"></div>
            <div className="relative z-10 flex flex-col md:flex-row gap-8 items-center text-center md:text-left">
              <div className={cn("w-24 h-24 rounded-3xl flex items-center justify-center shadow-lg bg-white border border-outline-variant", tabContent[activeTab].color)}>
                <ActiveIcon className="w-12 h-12" />
              </div>
              <div className="flex-1">
                <h2 className="text-3xl font-bold text-on-surface tracking-tight">{tabContent[activeTab].title}</h2>
                <p className="text-outline mt-2 text-lg max-w-xl font-medium">{tabContent[activeTab].description}</p>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <button 
                  onClick={() => setIsImporting(true)}
                  className="px-6 py-4 bg-surface-container-high text-on-surface rounded-2xl font-bold hover:bg-surface-container-highest active:scale-95 transition-all flex items-center gap-2 border border-outline-variant"
                >
                  <FileUp className="w-5 h-5 text-primary" /> Importar
                </button>
                <button 
                  onClick={() => setIsRecording(true)}
                  className="px-8 py-4 bg-primary text-white rounded-2xl font-bold shadow-xl shadow-primary/10 hover:brightness-110 active:scale-95 transition-all flex items-center gap-2"
                >
                  <Plus className="w-5 h-5" /> Iniciar Manejo
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 lg:grid-cols-4 gap-6 mt-12 border-t border-outline-variant pt-10">
              {tabContent[activeTab].stats.map((stat, i) => (
                <div key={i} className="flex flex-col">
                  <span className="text-[10px] uppercase tracking-widest font-bold text-outline mb-2">{stat.label}</span>
                  <div className="flex items-center gap-3">
                    <stat.icon className="w-5 h-5 text-primary opacity-50" />
                    <span className="text-2xl font-black text-on-surface">{stat.value}</span>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* Search and Action Bar */}
          <div className="flex flex-col md:flex-row gap-4 items-center">
            <div className="relative flex-1 group w-full">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-outline w-5 h-5 group-focus-within:text-primary transition-colors" />
              <input 
                type="text" 
                placeholder="Pesquisar Brinco ou IDE do animal..." 
                className="w-full pl-12 pr-4 py-4 bg-surface-container-lowest border border-outline-variant rounded-2xl font-medium outline-none focus:border-primary focus:ring-4 focus:ring-primary/5 transition-all shadow-sm"
              />
            </div>
            <button type="button" onClick={() => setShowFullHistory(v => !v)} className="w-full md:w-auto px-6 py-4 bg-surface-container-highest text-primary font-bold rounded-2xl flex items-center justify-center gap-2 border border-outline-variant hover:bg-surface-container transition-all">
              <FileText className="w-5 h-5" /> {showFullHistory ? 'Mostrar recentes' : 'Histórico Completo'}
            </button>
          </div>

          {/* Responsive List Section */}
          <section className="bg-surface-container-lowest rounded-3xl border border-outline-variant overflow-hidden">
            <div className="px-8 py-6 border-b border-outline-variant flex items-center justify-between bg-surface-container-high/30">
              <h3 className="font-bold text-on-surface">
                {activeTab === 'reproduction' ? 'Pendentes para Diagnóstico' : 'Atividades Recentes'}
              </h3>
              <div className="flex items-center gap-4 text-xs font-bold text-outline">
                <span>{activeTab === 'weight' ? 'PESAGENS CARREGADAS' : 'TOTAL'}: {pendingAnimals.length}</span>
                <span className="w-1 h-1 bg-outline-variant rounded-full"></span>
                <button disabled={loadingPending} onClick={async () => { setRefreshMessage('Atualizando...'); await fetchPendingAnimals(); setRefreshMessage('Consulta concluída'); }} className="text-primary hover:underline flex items-center gap-1 disabled:opacity-50">
                  <Activity className="w-3 h-3" /> {loadingPending ? 'Atualizando...' : 'Atualizar'}
                </button>
                {refreshMessage && <span role="status">{refreshMessage}</span>}
              </div>
            </div>
            
            {loadingPending ? (
              <div className="p-12 flex justify-center">
                <Loader2 className="w-8 h-8 animate-spin text-primary opacity-20" />
              </div>
            ) : pendingAnimals.length === 0 ? (
              <div className="p-16 text-center flex flex-col items-center bg-surface-container-low/20">
                <div className="w-24 h-24 bg-white shadow-inner rounded-full flex items-center justify-center mb-6 border border-outline-variant/50">
                  {activeTab === 'reproduction' ? (
                    <Activity className="w-10 h-10 text-primary opacity-20" />
                  ) : (
                    <Search className="w-10 h-10 text-outline/30" />
                  )}
                </div>
                <h4 className="text-2xl font-black text-on-surface tracking-tight">
                  {activeTab === 'reproduction' ? 'Tudo em dia!' : 'Nenhuma atividade recente'}
                </h4>
                <p className="text-outline max-w-sm mt-3 font-medium leading-relaxed">
                  {activeTab === 'reproduction' 
                    ? 'No momento não existem animais aguardando diagnóstico de gestação. Todos os ciclos registrados estão concluídos.' 
                    : 'Ainda não foram registrados manejos para este lote hoje. Inicie um novo manejo pesquisando por um animal.'}
                </p>
                <div className="mt-8 flex gap-3">
                  <button 
                    onClick={() => {
                        const input = document.querySelector('input[type="text"]') as HTMLInputElement;
                        input?.focus();
                    }}
                    className="px-6 py-3 bg-white text-primary font-bold rounded-xl border border-outline-variant shadow-sm hover:bg-surface-container-lowest transition-all text-xs uppercase tracking-widest"
                  >
                    Pesquisar Animal
                  </button>
                </div>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-surface-container-low/50">
                      <th 
                        className="px-8 py-4 text-[10px] font-black uppercase tracking-widest text-outline cursor-pointer hover:bg-surface-container-high transition-colors"
                        onClick={() => requestSort('tag_number')}
                      >
                        <div className="flex items-center gap-2">
                          Animal / Brinco
                          {getSortIcon('tag_number')}
                        </div>
                      </th>
                      <th 
                        className="px-8 py-4 text-[10px] font-black uppercase tracking-widest text-outline cursor-pointer hover:bg-surface-container-high transition-colors"
                        onClick={() => requestSort('value')}
                      >
                        <div className="flex items-center gap-2">
                          {activeTab === 'reproduction' ? 'Evento / Manejo' : (activeTab === 'weight' ? 'Peso' : 'Tratamento')}
                          {getSortIcon('value')}
                        </div>
                      </th>
                      <th 
                        className="px-8 py-4 text-[10px] font-black uppercase tracking-widest text-outline cursor-pointer hover:bg-surface-container-high transition-colors"
                        onClick={() => requestSort('pasture')}
                      >
                        <div className="flex items-center gap-2">
                          Pasto / Lote
                          {getSortIcon('pasture')}
                        </div>
                      </th>
                      <th 
                        className="px-8 py-4 text-[10px] font-black uppercase tracking-widest text-outline cursor-pointer hover:bg-surface-container-high transition-colors"
                        onClick={() => requestSort('date')}
                      >
                        <div className="flex items-center gap-2">
                          {activeTab === 'reproduction' ? 'Prazos / Status' : 'Data'}
                          {getSortIcon('date')}
                        </div>
                      </th>
                      <th className="px-8 py-4 text-right"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-outline-variant">
                    {(activeTab === 'weight' && !showFullHistory ? sortedPendingAnimals.slice(0, 10) : sortedPendingAnimals).map((item, idx) => {
                      const daysPassed = item.inserted_at ? Math.floor((new Date().getTime() - new Date(item.inserted_at).getTime()) / (1000 * 3600 * 24)) : 0;
                      const isReadyForDiagnosis = activeTab === 'reproduction' && daysPassed >= 28;

                      return (
                        <motion.tr 
                          initial={{ opacity: 0, x: -10 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ delay: idx * 0.05 }}
                          key={item.id} 
                          className="hover:bg-surface-container-low transition-colors group"
                        >
                          <td className="px-8 py-4">
                            <div className="flex items-center gap-3">
                              <div className="w-11 h-11 bg-primary text-white rounded-xl flex items-center justify-center font-black text-sm shadow-sm ring-4 ring-primary/5">
                                {item.cattle?.tag_number || 'N/A'}
                              </div>
                              <div className="flex flex-col">
                                <span className="text-xs font-bold text-on-surface">Brinco Oficial</span>
                                <span className="text-[10px] font-medium text-outline uppercase">Identificado</span>
                              </div>
                            </div>
                          </td>
                          <td className="px-8 py-4">
                            <div className="flex flex-col">
                              <span className="text-sm font-bold text-on-surface">
                                {activeTab === 'reproduction' 
                                  ? (item.event_type === 'insemination' ? 'Inseminação (IA)' : 'Monta Natural')
                                  : (activeTab === 'weight' ? `${item.weight_kg}kg` : (item.medication || item.record_type))}
                              </span>
                              {activeTab === 'reproduction' && (
                                <span className="text-[10px] font-medium text-primary">
                                  Touro: {item.semen_bull || item.male_bull_tag || 'N/A'}
                                </span>
                              )}
                              <span className="text-[9px] font-medium text-outline-variant mt-0.5">
                                Realizado: {new Date(activeTab === 'weight' ? (item.weighing_date || item.inserted_at) : item.inserted_at).toLocaleDateString('pt-BR')}
                              </span>
                            </div>
                          </td>
                          <td className="px-8 py-4">
                            <div className="flex items-center gap-2">
                              <div className="w-1.5 h-1.5 bg-primary rounded-full"></div>
                              <span className="text-xs font-bold text-on-surface uppercase tracking-tight">
                                {item.cattle?.pasture || 'Sem Lote'}
                              </span>
                            </div>
                          </td>
                          <td className="px-8 py-4">
                            {activeTab === 'reproduction' ? (
                              <div className="flex flex-col gap-1">
                                <div className={cn(
                                  "px-2 py-0.5 rounded text-[9px] font-black uppercase tracking-widest inline-flex w-fit",
                                  isReadyForDiagnosis ? "bg-green-100 text-green-700 border border-green-200" : "bg-amber-100 text-amber-700 border border-amber-200"
                                )}>
                                  {isReadyForDiagnosis ? 'Pronto para DG' : 'Em Espera'}
                                </div>
                                <span className="text-[10px] font-bold text-outline uppercase tracking-tight">
                                  {daysPassed} dias decorridos
                                </span>
                              </div>
                            ) : (
                              <div className="flex flex-col">
                                <span className="text-xs font-bold text-outline uppercase tracking-tight">
                                  {new Date(activeTab === 'weight' ? (item.weighing_date || item.inserted_at) : item.inserted_at).toLocaleDateString('pt-BR')}
                                </span>
                                <span className="text-[10px] font-medium text-outline-variant">
                                  {new Date(activeTab === 'weight' ? (item.weighing_date || item.inserted_at) : item.inserted_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                                </span>
                              </div>
                            )}
                          </td>
                          <td className="px-8 py-4 text-right">
                            <button 
                              onClick={async () => {
                                const q = item.cattle?.tag_number || '';
                                setSearchQuery(q);
                                await handleSearchAnimal(undefined, q);
                                setIsRecording(true);
                              }}
                              className={cn(
                                "px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all inline-flex items-center gap-2",
                                isReadyForDiagnosis 
                                  ? "bg-primary text-white shadow-lg shadow-primary/20 hover:brightness-110" 
                                  : "bg-surface-container-highest text-primary hover:bg-primary hover:text-white"
                              )}
                            >
                              {activeTab === 'reproduction' ? (isReadyForDiagnosis ? 'Iniciar DG' : 'Ver Ficha') : 'Ver'}
                              <ArrowRight className="w-3.5 h-3.5" />
                            </button>
                          </td>
                        </motion.tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* Recent Manejo Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div className="bg-surface-container-lowest p-8 rounded-3xl border border-outline-variant space-y-6">
              <div className="flex justify-between items-center">
                <h3 className="text-lg font-bold text-on-surface">Dicas de Manejo</h3>
                <ShieldCheck className="w-5 h-5 text-emerald-500" />
              </div>
              <div className="space-y-4">
                <div className="p-4 bg-emerald-50 rounded-2xl border border-emerald-100">
                  <p className="text-sm font-bold text-emerald-900 leading-relaxed uppercase tracking-wide text-[10px] mb-1">Dica de Bem-Estar</p>
                  <p className="text-sm text-emerald-800 font-medium">Evite o uso de choques e gritos no curral. Manejo racional reduz o estresse e aumenta a produtividade.</p>
                </div>
                <div className="p-4 bg-primary-container/10 rounded-2xl border border-primary/10">
                  <p className="text-sm font-bold text-primary leading-relaxed uppercase tracking-wide text-[10px] mb-1">Importante</p>
                  <p className="text-sm text-primary/80 font-medium">Mantenha a balança sempre aferida antes de iniciar as pesagens do dia.</p>
                </div>
              </div>
            </div>

            <div className="bg-primary text-white p-8 rounded-3xl shadow-xl shadow-primary/20 relative overflow-hidden group">
              <div className="absolute right-0 bottom-0 translate-y-1/4 translate-x-1/4 opacity-10 group-hover:scale-110 transition-transform duration-700">
                <TrendingUp className="w-48 h-48" />
              </div>
              <div className="relative z-10">
                <div className="bg-white/20 w-12 h-12 rounded-xl flex items-center justify-center mb-6">
                  <Activity className="w-6 h-6" />
                </div>
                <h3 className="text-2xl font-bold mb-2">Análise de Desempenho</h3>
                <p className="text-white/70 font-medium mb-8">Veja como o seu rebanho está performando em relação às metas de engorda.</p>
                <button className="bg-white text-primary px-6 py-3 rounded-xl font-bold hover:bg-opacity-90 transition-all flex items-center gap-2">
                  Ver Dashboard de Rebanho <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        </motion.div>
      </div>

      {/* Import Dialog */}
      {isImporting && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-surface-container-lowest w-full max-w-2xl rounded-[2.5rem] border border-outline-variant shadow-2xl overflow-hidden"
          >
            <div className="p-8 border-b border-outline-variant flex items-center justify-between bg-surface-container-low">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-primary/10 rounded-2xl flex items-center justify-center">
                  <FileUp className="w-6 h-6 text-primary" />
                </div>
                <div>
                  <h3 className="text-xl font-bold text-on-surface leading-none">Importar Dados</h3>
                  <p className="text-xs text-outline mt-1 font-medium uppercase tracking-widest">Suporte para CSV e Excel</p>
                </div>
              </div>
              <button 
                onClick={() => {
                  if (!importLoading) {
                    setIsImporting(false)
                    setImportResults(null)
                  }
                }}
                className="p-2 hover:bg-surface-container-high rounded-full transition-colors"
              >
                <X className="w-6 h-6 text-outline" />
              </button>
            </div>

            <div className="p-8">
              <div className="mb-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                A importação convencional está temporariamente desativada para proteger os dados.
                <button type="button" onClick={() => router.push('/dashboard/herd?import=trutest')} className="ml-2 font-bold underline">Abrir importação segura Tru-Test em Rebanho</button>
              </div>
              {!importResults ? (
                <div className="space-y-8">
                  <div className="bg-surface-container-low p-6 rounded-3xl border border-outline-variant">
                    <div className="flex items-center justify-between mb-4">
                      <h4 className="text-sm font-bold text-on-surface">Instruções da Planilha</h4>
                      <button 
                        onClick={downloadTemplate}
                        className="flex items-center gap-2 text-xs font-bold text-primary hover:text-primary/80 transition-colors bg-primary/5 px-3 py-1.5 rounded-xl border border-primary/20"
                      >
                        <Download className="w-3.5 h-3.5" />
                        Baixar Modelo Base
                      </button>
                    </div>
                    <ul className="space-y-3">
                      <li className="flex items-start gap-3">
                         <div className="w-1.5 h-1.5 bg-primary rounded-full mt-1.5 shrink-0"></div>
                        <p className="text-sm text-outline font-medium">Colunas principais: <strong className="text-on-surface">IDV (Brinco), IDE (Eletrônico), Peso</strong></p>
                      </li>
                      <li className="flex items-start gap-3">
                        <div className="w-1.5 h-1.5 bg-primary rounded-full mt-1.5 shrink-0"></div>
                        <p className="text-sm text-outline font-medium">Outras: <strong className="text-on-surface">Sexo, Categoria, Classificar, GMD, GPV, observações, data, Hora</strong></p>
                      </li>
                      <li className="flex items-start gap-3">
                        <div className="w-1.5 h-1.5 bg-primary rounded-full mt-1.5 shrink-0"></div>
                        <p className="text-sm text-outline font-medium">Se o animal não existir, ele será <strong className="text-on-surface">criado automaticamente</strong>.</p>
                      </li>
                    </ul>
                  </div>

                  {!importLoading ? (
                    <div className="relative">
                      <input 
                        type="file" 
                        accept=".csv,.xlsx,.xls"
                        disabled
                        aria-label="Importação convencional desativada; utilize a importação segura em Rebanho"
                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                      />
                      <div className="border-2 border-dashed border-outline-variant rounded-3xl p-12 flex flex-col items-center justify-center gap-4 bg-surface-container-lowest hover:bg-surface-container-low hover:border-primary/50 transition-all group">
                        <div className="w-16 h-16 bg-surface-container-high rounded-full flex items-center justify-center group-hover:scale-110 group-hover:bg-primary/10 transition-all">
                          <Sheet className="w-8 h-8 text-outline group-hover:text-primary transition-colors" />
                        </div>
                        <div className="text-center">
                          <p className="text-lg font-bold text-on-surface">Clique ou arraste o arquivo</p>
                          <p className="text-sm text-outline font-medium">Tamanho máximo: 10MB</p>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="p-12 flex flex-col items-center justify-center gap-6">
                      <Loader2 className="w-12 h-12 text-primary animate-spin" />
                      <div className="text-center space-y-2">
                        <p className="text-xl font-bold text-on-surface">Processando planilha...</p>
                        <p className="text-sm text-outline font-medium">Importando {importProgress.current} de {importProgress.total} registros</p>
                      </div>
                      <div className="w-full bg-surface-container-high h-3 rounded-full overflow-hidden max-w-md">
                        <motion.div 
                          className="h-full bg-primary"
                          initial={{ width: 0 }}
                          animate={{ width: `${(importProgress.current / importProgress.total) * 100}%` }}
                        />
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="space-y-8">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="bg-emerald-50 p-6 rounded-3xl border border-emerald-100 flex flex-col items-center">
                      <span className="text-3xl font-black text-emerald-700">{importResults.success}</span>
                      <span className="text-xs font-bold text-emerald-600 uppercase tracking-widest mt-1">Sucessos</span>
                    </div>
                    <div className="bg-red-50 p-6 rounded-3xl border border-red-100 flex flex-col items-center">
                      <span className="text-3xl font-black text-red-700">{importResults.error}</span>
                      <span className="text-xs font-bold text-red-600 uppercase tracking-widest mt-1">Falhas</span>
                    </div>
                  </div>

                  {importResults.details.length > 0 && (
                    <div className="bg-surface-container-low rounded-3xl border border-outline-variant overflow-hidden">
                      <div className="p-4 border-b border-outline-variant bg-surface-container-high">
                        <h4 className="text-xs font-black text-outline uppercase tracking-widest">Detalhes dos Erros</h4>
                      </div>
                      <div className="max-h-40 overflow-y-auto p-4 space-y-2">
                        {importResults.details.map((detail, idx) => (
                          <p key={idx} className="text-xs font-medium text-red-600 flex items-start gap-2">
                            <AlertCircle className="w-3 h-3 shrink-0 mt-0.5" />
                            {detail}
                          </p>
                        ))}
                      </div>
                    </div>
                  )}

                  <button 
                    onClick={() => {
                      setIsImporting(false)
                      setImportResults(null)
                    }}
                    className="w-full py-5 bg-on-surface text-surface-container-lowest rounded-2xl font-black text-xl hover:brightness-110 active:scale-98 transition-all"
                  >
                    Concluir Importação
                  </button>
                </div>
              )}
            </div>
          </motion.div>
        </div>
      )}
    </DashboardLayout>
  )
}

function CheckCircle(props: any) {
  return (
    <svg
      {...props}
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
      <polyline points="22 4 12 14.01 9 11.01" />
    </svg>
  )
}
